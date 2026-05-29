import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CircleMarker,
  Circle,
  FeatureGroup,
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMapEvents,
  useMap,
} from 'react-leaflet'
import L, { divIcon, type LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'

import {
  getSwedishAirports,
  getSwedishAirspaces,
  getSwedishNavaids,
  getSwedishVisualPoints,
  type SwedishAirport,
  type SwedishAirspace,
  type SwedishAirspaceGeometry,
  type SwedishNavaid,
  type SwedishVisualPoint,
} from './aviationData'
import { calculateFlightPlan, formatTimeFromMinutes } from './calculations'
import { formatCoordinateDms } from './coordinates'
import { DEFAULT_ROUTE_TAS_KT } from './data'
import { getRoutePointLabel, legsToWaypoints, pointWithNearestName, waypointsToLegs } from './gazetteer'
import { calculateRouteLegMagneticVariations } from './magneticVariation'
import {
  classifyMetarFlightRules,
  classifyTafFlightRules,
  fetchMapWeatherForAirports,
  mergeFlightRules,
  needsAirportWeatherRefetchForMap,
  WEATHER_MAP_CACHE_MAX_AGE_MS,
  type AirportMapWeather,
  type MetarFlightCategory,
  type MetarFlightRules,
  type NearbyAirport,
} from './weather'
import {
  createEmptyNotamMapCoverageCheck,
  formatNotamMapCoverageLabel,
  formatNotamText,
  type NotamMapCoverageCheck,
  type NotamMapOverlayFeature,
} from './notamRoute'
import { fetchNotamsForAirports, type AirportNotam } from './notam'
import { getAllWeatherOverlays, type RouteWeatherOverlay } from './weatherSigmet'
import type { RouteLegAloftWind } from './openMeteoAloft'
import {
  fetchSwedishObstacles,
  getObstacleDisplayType,
  type SwedishObstacle,
} from './obstacles'
import type { FlightPlanInput, FlightPlanDerived } from './types'
import type { FlightplanMapbox3DStyle, FlightplanMapboxAirportFlightCategory } from './FlightplanMapbox3D'
import { getLeafletAirspacePathOptions } from './aeronauticalMapSymbols'

const FlightplanMapbox3D = lazy(async () => ({
  default: (await import('./FlightplanMapbox3D')).FlightplanMapbox3D,
}))

type BasemapKey = 'topo' | 'osm' | 'hot' | 'mapbox3d-ortho' | 'mapbox3d-topo' | 'mapbox3d-standard' | 'mapbox3d-light'

type MapLayerPreferences = {
  airspaces: boolean
  weatherOverlays: boolean
  notamOverlays: boolean
  aloftWindArrows: boolean
  navaids: boolean
  visualPoints: boolean
  obstacles: boolean
  airports: boolean
  metar: boolean
  taf: boolean
}

type MapLayerPreferenceKey = keyof MapLayerPreferences
type NotamMapNoticeLink = {
  label: string
  href: string
}
type PointInfoAirspace = {
  id: string
  kind: string
  name: string | null
  positionIndicator: string | null
  lower: string | null
  upper: string | null
}
type PointInfoAirport = {
  id: string
  icao: string | null
  label: string
  name: string
  distanceNm: number
  weatherLines: string[]
  serviceHoursSchedule: AirportServiceHoursSchedule | null
  adNotam: AirportNotamLookup | null
}
type PointInfoNavaid = {
  id: string
  label: string
  kind: SwedishNavaid['kind']
  frequency: string | null
  channel: string | null
  distanceNm: number
}
type PointInfoNotamFeature = {
  feature: NotamMapOverlayFeature
  distanceNm: number
}
type MapPointInfo = {
  lat: number
  lon: number
  coordinateLabel: string
  airspaces: PointInfoAirspace[]
  airports: PointInfoAirport[]
  navaids: PointInfoNavaid[]
  visualPoints: PointInfoVisualPoint[]
  obstacles: PointInfoObstacle[]
  notamFeatures: PointInfoNotamFeature[]
}
type MapPointInfoDirectObjects = Partial<Pick<MapPointInfo, 'airports' | 'navaids' | 'visualPoints' | 'notamFeatures'>>
type PointInfoObstacle = {
  obstacle: SwedishObstacle
  distanceNm: number
}
type PointInfoVisualPoint = {
  id: string
  label: string
  kind: SwedishVisualPoint['kind']
  positionIndicator: string | null
  location: string | null
  distanceNm: number
}
type AirspaceMapLabel = {
  id: string
  label: string
  position: [number, number]
  variant: string
}
type AirportNotamLookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; entry: AirportNotam | null }
  | { status: 'error'; error: string }
type WeekdayKey = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
type AirportTowerHoursInterval = {
  startMinutes: number
  endMinutes: number
  label: string
}
type AirportTowerHoursDay = {
  key: WeekdayKey
  label: string
  raw: string
  intervals: AirportTowerHoursInterval[]
  isCurrentDay: boolean
  status: 'open' | 'closed' | 'unknown' | null
}
type AirportServiceHoursKind = 'TWR' | 'AFIS'
type AirportServiceHoursSection = {
  kind: AirportServiceHoursKind
  lines: string[]
}
type AirportServiceHoursSchedule = {
  title: string
  days: AirportTowerHoursDay[]
}

const mapLayerPreferencesStorageKey = 'flightplan.mapLayerPreferences.v2'
const mapBasemapStorageKey = 'flightplan.basemap.v1'

const defaultMapLayerPreferences: MapLayerPreferences = {
  airspaces: true,
  weatherOverlays: true,
  notamOverlays: false,
  aloftWindArrows: true,
  navaids: true,
  visualPoints: true,
  obstacles: false,
  airports: true,
  metar: true,
  taf: false,
}

const basemaps: Record<
  BasemapKey,
  { label: string; url: string | null; attribution: string | null; maxNativeZoom?: number; maxZoom?: number }
> = {
  topo: {
    label: 'OSM Topografisk',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxNativeZoom: 17,
    maxZoom: 17,
  },
  osm: {
    label: 'Open Street Map',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    maxZoom: 19,
  },
  hot: {
    label: 'OSM Humanitär',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, style by Humanitarian OpenStreetMap Team hosted by <a href="https://www.openstreetmap.fr/">OpenStreetMap France</a>',
    maxNativeZoom: 20,
    maxZoom: 20,
  },
  'mapbox3d-ortho': {
    label: '3D Mapbox Orto (Beta)',
    url: null,
    attribution: null,
  },
  'mapbox3d-topo': {
    label: '3D Mapbox Topo (Beta)',
    url: null,
    attribution: null,
  },
  'mapbox3d-standard': {
    label: '3D Mapbox Standard (Beta)',
    url: null,
    attribution: null,
  },
  'mapbox3d-light': {
    label: '3D Mapbox Light (Beta)',
    url: null,
    attribution: null,
  },
}

function isMapbox3dBasemapKey(value: BasemapKey) {
  return value.startsWith('mapbox3d-')
}

function getMapbox3DStyle(value: BasemapKey): FlightplanMapbox3DStyle {
  if (value === 'mapbox3d-topo') {
    return 'topo'
  }

  if (value === 'mapbox3d-standard') {
    return 'standard'
  }

  if (value === 'mapbox3d-light') {
    return 'light'
  }

  return 'ortho'
}

function readStoredBasemap(): BasemapKey {
  if (typeof window === 'undefined') {
    return 'topo'
  }

  const stored = window.localStorage.getItem(mapBasemapStorageKey)
  if (stored === 'mapbox3d') {
    return 'mapbox3d-ortho'
  }

  return stored === 'topo' ||
    stored === 'osm' ||
    stored === 'hot' ||
    stored === 'mapbox3d-ortho' ||
    stored === 'mapbox3d-topo' ||
    stored === 'mapbox3d-standard' ||
    stored === 'mapbox3d-light'
    ? stored
    : 'topo'
}

const waypointIcon = divIcon({
  className: 'fp-waypoint-icon',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function createAirportIcon(category: MetarFlightCategory, size: 'default' | 'small' = 'default') {
  const label = category === 'VMC' ? 'V' : category === 'MVMC' ? 'M' : category === 'IMC' ? 'I' : ''
  const variant =
    category === 'VMC'
      ? 'is-vmc'
      : category === 'MVMC'
        ? 'is-mvmc'
        : category === 'IMC'
          ? 'is-imc'
          : 'is-unknown'

  return divIcon({
    className: `fp-airport-marker ${size === 'small' ? 'fp-airport-marker--small' : ''}`,
    html: `<span class="${variant}">${label}</span>`,
    iconSize: size === 'small' ? [14, 14] : [20, 20],
    iconAnchor: size === 'small' ? [7, 7] : [10, 10],
  })
}

function getAirportDisplayFlightRules(
  weather: AirportMapWeather | null,
  options: { showMetar: boolean; showTaf: boolean },
): MetarFlightRules {
  if (!options.showMetar && !options.showTaf) {
    return {
      category: 'UNKNOWN',
      visibilityMeters: null,
      ceilingFeet: null,
    }
  }

  const metarRules = options.showMetar ? classifyMetarFlightRules(weather?.metarRawText ?? null) : null
  const tafRules = options.showTaf ? classifyTafFlightRules(weather?.tafRawText ?? null) : null

  return mergeFlightRules(metarRules, tafRules)
}

function getAirportTooltipWeatherLines(
  weather: AirportMapWeather | null,
) {
  const lines: string[] = []

  if (weather?.metarRawText) {
    lines.push(`METAR ${weather.metarRawText}`)
  }

  if (weather?.tafRawText) {
    lines.push(`TAF ${weather.tafRawText}`)
  }

  return lines
}

function hasAirportWeatherData(
  weather: AirportMapWeather | null,
  options: { showMetar: boolean; showTaf: boolean },
) {
  return Boolean(
    (options.showMetar && weather?.metarRawText) ||
    (options.showTaf && weather?.tafRawText),
  )
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function createMapLabelIcon(className: string, label: string) {
  return divIcon({
    className,
    html: `<span>${escapeHtml(label)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function normalizeDegrees(value: number) {
  const result = value % 360
  return result < 0 ? result + 360 : result
}

function distanceNmBetween(lat: number, lon: number, toLat: number, toLon: number) {
  return L.latLng(lat, lon).distanceTo([toLat, toLon]) / 1852
}

function formatDistanceNm(value: number) {
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} NM`
}

const routeLineWeight = 6
const airspaceLabelMinZoom = 8
const airspaceLabelMinSizePx = 120
const airportLabelMinZoom = 8
const airportMarkerRadiusPx = 4
const navaidMinZoom = 7
const navaidLabelMinZoom = 9
const visualPointMinZoom = 10
const visualPointLabelMinZoom = 11
const obstacleMinZoom = 8
const obstacleInspectRadiusNm = 3
const directionArrowWaypointClearancePx = 22
const maxVisibleAirspaceLowerFt = 9500
const notamAreaToPointThresholdPx = 12
const notamAreaCollapseMaxZoom = 11
const notamPointInspectRadiusNm = 8
const notamLineInspectRadiusNm = 5
const labelBoundsPaddingRatio = 0.03
const sigmetOverlayPalette = {
  color: '#a61e4d',
  fillColor: '#f05d88',
  lineColor: '#b44300',
  lineFill: '#ffd0a6',
} as const

const notamMapPane = 'fp-notam-pane'
const notamMapHighlightPane = 'fp-notam-highlight-pane'
const obstacleMapPane = 'fp-obstacle-pane'

function readStoredMapLayerPreferences(): MapLayerPreferences {
  if (typeof window === 'undefined') {
    return defaultMapLayerPreferences
  }

  const raw = window.localStorage.getItem(mapLayerPreferencesStorageKey)
  if (!raw) {
    return defaultMapLayerPreferences
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<MapLayerPreferenceKey, unknown>>
    return {
      airspaces: typeof parsed.airspaces === 'boolean' ? parsed.airspaces : defaultMapLayerPreferences.airspaces,
      weatherOverlays: typeof parsed.weatherOverlays === 'boolean' ? parsed.weatherOverlays : defaultMapLayerPreferences.weatherOverlays,
      notamOverlays: typeof parsed.notamOverlays === 'boolean' ? parsed.notamOverlays : defaultMapLayerPreferences.notamOverlays,
      aloftWindArrows: typeof parsed.aloftWindArrows === 'boolean' ? parsed.aloftWindArrows : defaultMapLayerPreferences.aloftWindArrows,
      navaids: typeof parsed.navaids === 'boolean' ? parsed.navaids : defaultMapLayerPreferences.navaids,
      visualPoints: typeof parsed.visualPoints === 'boolean' ? parsed.visualPoints : defaultMapLayerPreferences.visualPoints,
      obstacles: typeof parsed.obstacles === 'boolean' ? parsed.obstacles : defaultMapLayerPreferences.obstacles,
      airports: typeof parsed.airports === 'boolean' ? parsed.airports : defaultMapLayerPreferences.airports,
      metar: typeof parsed.metar === 'boolean' ? parsed.metar : defaultMapLayerPreferences.metar,
      taf: typeof parsed.taf === 'boolean' ? parsed.taf : defaultMapLayerPreferences.taf,
    }
  } catch {
    return defaultMapLayerPreferences
  }
}

function MapLayerSwitch({
  checked,
  disabled = false,
  label,
  meta,
  onToggle,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  meta?: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="fp-map-layer-switch"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="fp-map-layer-switch__text">
        <span>{label}</span>
        {meta ? <small>{meta}</small> : null}
      </span>
      <span className="fp-map-layer-switch__track" aria-hidden="true">
        <span className="fp-map-layer-switch__thumb" />
      </span>
    </button>
  )
}

function getObstaclePalette(obstacle: SwedishObstacle) {
  switch (obstacle.category) {
    case 'wind_turbine':
      return { color: '#0f766e', fillColor: '#2dd4bf', radius: 4.8 }
    case 'mast':
    case 'tower':
      return { color: '#7c2d12', fillColor: '#f97316', radius: 4.4 }
    case 'chimney':
    case 'crane':
      return { color: '#991b1b', fillColor: '#ef4444', radius: 4.8 }
    case 'building':
      return { color: '#475569', fillColor: '#94a3b8', radius: 4.2 }
    case 'vegetation':
      return { color: '#166534', fillColor: '#65a30d', radius: 3.8 }
    case 'powerline_or_pylon':
      return { color: '#854d0e', fillColor: '#eab308', radius: 4.2 }
    case 'navaid':
      return { color: '#4338ca', fillColor: '#818cf8', radius: 4.4 }
    case 'other':
      return { color: '#334155', fillColor: '#64748b', radius: 3.8 }
  }
}

function formatObstacleHeight(value: number | null, unit: string | null) {
  if (value == null) {
    return null
  }

  return `${Math.round(value)} ${unit ?? 'M'}`
}

function getOverlayStrokeWeight(
  zoom: number,
  profile: 'weather-area' | 'weather-line' | 'notam-area' | 'notam-line',
) {
  if (profile === 'weather-area') {
    if (zoom <= 6) {
      return 1
    }
    if (zoom <= 8) {
      return 1.2
    }
    if (zoom <= 10) {
      return 1.5
    }
    return 1.8
  }

  if (profile === 'weather-line') {
    if (zoom <= 6) {
      return 1.4
    }
    if (zoom <= 8) {
      return 1.8
    }
    if (zoom <= 10) {
      return 2.2
    }
    return 2.6
  }

  if (profile === 'notam-area') {
    if (zoom <= 6) {
      return 1
    }
    if (zoom <= 8) {
      return 1.25
    }
    if (zoom <= 10) {
      return 1.5
    }
    return 1.9
  }

  if (zoom <= 6) {
    return 1.4
  }
  if (zoom <= 8) {
    return 1.8
  }
  if (zoom <= 10) {
    return 2.2
  }
  return 2.8
}

function notamMapPathOptions(source: NotamMapOverlayFeature['source'], kind: 'area' | 'line', zoom: number) {
  if (source === 'notam-enroute') {
    return kind === 'area'
      ? {
          color: '#b45309',
          fillColor: '#fcd34d',
          fillOpacity: 0.22,
          weight: getOverlayStrokeWeight(zoom, 'notam-area'),
          dashArray: '5 4' as const,
        }
      : { color: '#b45309', weight: getOverlayStrokeWeight(zoom, 'notam-line'), opacity: 0.92, dashArray: '6 5' as const }
  }

  if (source === 'notam-warning') {
    return kind === 'area'
      ? { color: '#b91c1c', fillColor: '#fca5a5', fillOpacity: 0.22, weight: getOverlayStrokeWeight(zoom, 'notam-area') + 0.15 }
      : { color: '#b91c1c', weight: getOverlayStrokeWeight(zoom, 'notam-line') + 0.2, opacity: 0.95, dashArray: '2 4' as const }
  }

  return kind === 'area'
    ? {
        color: '#4338ca',
        fillColor: '#a5b4fc',
        fillOpacity: 0.2,
        weight: getOverlayStrokeWeight(zoom, 'notam-area'),
        dashArray: '8 4' as const,
      }
    : { color: '#4338ca', weight: getOverlayStrokeWeight(zoom, 'notam-line'), opacity: 0.9, dashArray: '10 5' as const }
}

function createNotamMapSymbolIcon(source: NotamMapOverlayFeature['source']) {
  const variant = source === 'notam-enroute' ? 'enroute' : source === 'notam-warning' ? 'warning' : 'sup'
  return divIcon({
    className: `fp-notam-map-symbol fp-notam-map-symbol--${variant}`,
    html: '<span></span>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })
}

function getFeatureMarkerPosition(feature: NotamMapOverlayFeature): [number, number] {
  if (feature.kind === 'circle') {
    return feature.positions[0] ?? [0, 0]
  }

  if (feature.kind === 'polygon' && feature.positions.length > 0) {
    const bounds = L.latLngBounds(feature.positions)
    const center = bounds.getCenter()
    return [center.lat, center.lng]
  }

  return feature.positions[0] ?? [0, 0]
}

function shouldCollapseNotamAreaToPoint(
  feature: NotamMapOverlayFeature,
  map: L.Map | null,
  zoom: number,
) {
  if (!map || zoom > notamAreaCollapseMaxZoom) {
    return false
  }

  if (feature.kind === 'circle' && feature.radiusNm != null) {
    const [lat, lon] = feature.positions[0] ?? [0, 0]
    const center = L.latLng(lat, lon)
    const bounds = center.toBounds(feature.radiusNm * 1852 * 2)
    const centerPoint = map.latLngToLayerPoint(center)
    const eastPoint = map.latLngToLayerPoint(bounds.getEast() === bounds.getWest()
      ? center
      : L.latLng(center.lat, bounds.getEast()))
    return centerPoint.distanceTo(eastPoint) <= notamAreaToPointThresholdPx
  }

  if (feature.kind === 'polygon' && feature.positions.length > 0) {
    const bounds = L.latLngBounds(feature.positions)
    const northEast = map.latLngToLayerPoint(bounds.getNorthEast())
    const southWest = map.latLngToLayerPoint(bounds.getSouthWest())
    const widthPx = Math.abs(northEast.x - southWest.x)
    const heightPx = Math.abs(northEast.y - southWest.y)
    return Math.max(widthPx, heightPx) <= notamAreaToPointThresholdPx
  }

  return false
}

function NotamMapInfoCard({ feature }: { feature: NotamMapOverlayFeature }) {
  const body = formatNotamText(feature.rawText)
  const preview = body.length > 2400 ? `${body.slice(0, 2400)}…` : body

  return (
    <div className="fp-airport-tooltip fp-notam-map-tooltip">
      <strong>{feature.label}</strong>
      <span className="fp-notam-map-tooltip__title">{feature.title}</span>
      {feature.supplementId ? (
        <span className="fp-notam-map-tooltip__meta">AIP SUP {feature.supplementId}</span>
      ) : null}
      {feature.source === 'aip-sup' && feature.supplementUrl ? (
        <a className="fp-notam-map-panel__link" href={feature.supplementUrl} target="_blank" rel="noreferrer">
          Öppna eSUP / källa
        </a>
      ) : null}
      <pre className="fp-notam-map-tooltip__body">{preview}</pre>
    </div>
  )
}

function normalizeAirportHoursLine(line: string) {
  return line
    .replace(/\s+/g, ' ')
    .replace(/\s+\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+\d{2}:?\d{2}(?:\s+EST)?$/i, '')
    .replace(/[;,]\s*$/g, '')
    .trim()
}

function normalizeAirportHoursDisplayValue(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN))?\b\s*/gi, '')
    .replace(/\b(?:DAILY|DLY|EVERY DAY)\b\s*/gi, '')
    .replace(/[;,]\s*$/g, '')
    .trim()
}

function getAirportServiceHoursSections(rawText: string | null): AirportServiceHoursSection[] {
  if (!rawText) {
    return []
  }

  const formatted = formatNotamText(rawText)
  const headingPattern = /(?:AERODROME\s+CONTROL\s+TOWER\s*\(TWR\)|CONTROL\s+TOWER\s*\(TWR\)|TOWER\s*\(TWR\)|\bTWR\b|AERODROME\s+FLIGHT\s+INFORMATION\s+SERVICE\s*\(AFIS\)|FLIGHT\s+INFORMATION\s+SERVICE\s*\(AFIS\)|\bAFIS\b)\s+HOURS\s+OF\s+SERVICE/gi
  const headingMatches = [...formatted.matchAll(headingPattern)]
    .map((match) => (match.index == null ? null : { text: match[0], index: match.index }))
    .filter((match): match is { text: string; index: number } => Boolean(match))

  if (headingMatches.length === 0) {
    return []
  }

  const stopPattern = /^(?:FROM:|TO:|AERODROME|ATS|RUNWAY|RWY|TAXIWAY|TWY|APRON|FUELLING|CUSTOMS|HANDLING|METEOROLOGICAL|RESCUE|FIRE|AD\s)/i
  return headingMatches
    .map((match, index) => {
      const nextMatch = headingMatches[index + 1]
      const afterHeading = formatted.slice(match.index + match.text.length, nextMatch?.index ?? undefined)
      const lines = afterHeading
        .split(/\n+/)
        .map(normalizeAirportHoursLine)
        .filter(Boolean)

      const hoursLines: string[] = []
      for (const line of lines) {
        if (hoursLines.length > 0 && stopPattern.test(line)) {
          break
        }

        hoursLines.push(line)
        if (hoursLines.length >= 4) {
          break
        }
      }

      return {
        kind: (/\bAFIS\b/i.test(match.text) ? 'AFIS' : 'TWR') as AirportServiceHoursKind,
        lines: hoursLines,
      }
    })
    .filter((section) => section.lines.length > 0)
}

function mergeRawWithSupplement(base: string, supplement: string, label: string) {
  if (supplement === 'Stängt') {
    return base
  }

  if (base === 'Stängt') {
    return `${label} ${supplement}`
  }

  return `${base} (${label} ${supplement})`
}

function formatAirportHoursDayValue(day: AirportTowerHoursDay) {
  if (day.intervals.length > 0) {
    return day.intervals.map((interval) => interval.label).join(', ')
  }

  return day.raw
}

function mergeAirportHoursDays(
  primary: AirportTowerHoursDay[],
  supplement: AirportTowerHoursDay[],
  supplementLabel: string,
) {
  const supplementByDay = new Map(supplement.map((day) => [day.key, day]))

  return primary.map((day) => {
    const supplementDay = supplementByDay.get(day.key)
    if (!supplementDay) {
      return day
    }

    return {
      ...day,
      raw: mergeRawWithSupplement(
        formatAirportHoursDayValue(day),
        formatAirportHoursDayValue(supplementDay),
        supplementLabel,
      ),
    }
  })
}

const weekdayKeys: WeekdayKey[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const weekdayLabels: Record<WeekdayKey, string> = {
  MON: 'Mån',
  TUE: 'Tis',
  WED: 'Ons',
  THU: 'Tor',
  FRI: 'Fre',
  SAT: 'Lör',
  SUN: 'Sön',
}

function getWeekdayRange(from: WeekdayKey, to: WeekdayKey) {
  const fromIndex = weekdayKeys.indexOf(from)
  const toIndex = weekdayKeys.indexOf(to)
  if (fromIndex < 0 || toIndex < 0) {
    return []
  }

  if (fromIndex <= toIndex) {
    return weekdayKeys.slice(fromIndex, toIndex + 1)
  }

  return [...weekdayKeys.slice(fromIndex), ...weekdayKeys.slice(0, toIndex + 1)]
}

function parseClockMinutes(value: string) {
  const normalized = value.replace(':', '')
  if (!/^\d{4}$/.test(normalized)) {
    return null
  }

  const hours = Number(normalized.slice(0, 2))
  const minutes = Number(normalized.slice(2))
  if (hours > 23 || minutes > 59) {
    return null
  }

  return hours * 60 + minutes
}

function formatClockMinutes(value: number) {
  if (value >= 24 * 60) {
    return '24:00'
  }

  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseTimeIntervals(value: string) {
  if (/\bH24\b/i.test(value)) {
    return [{ startMinutes: 0, endMinutes: 24 * 60, label: 'H24' }]
  }

  const parenthesized = [...value.matchAll(/\(([^)]*)\)/g)]
    .flatMap((match) => [...match[1].matchAll(/\b(\d{2}:?\d{2})\s*-\s*(\d{2}:?\d{2})\b/g)])

  const matches = parenthesized.length > 0
    ? parenthesized
    : [...value.matchAll(/\b(\d{2}:?\d{2})\s*-\s*(\d{2}:?\d{2})\b/g)]

  return matches
    .map((match) => {
      const startMinutes = parseClockMinutes(match[1])
      const endMinutes = parseClockMinutes(match[2])
      if (startMinutes == null || endMinutes == null) {
        return null
      }

      return {
        startMinutes,
        endMinutes: endMinutes <= startMinutes ? endMinutes + 24 * 60 : endMinutes,
        label: `${formatClockMinutes(startMinutes)}-${formatClockMinutes(endMinutes)}`,
      }
    })
    .filter((interval): interval is AirportTowerHoursInterval => Boolean(interval))
}

function getPlannedStartWeekday(date: string, plannedStartTime: string) {
  if (!date || !plannedStartTime) {
    return null
  }

  const normalizedTime = plannedStartTime.length === 5 ? `${plannedStartTime}:00` : plannedStartTime
  const start = new Date(`${date}T${normalizedTime}Z`)
  if (Number.isNaN(start.getTime())) {
    return null
  }

  const dayIndex = start.getUTCDay()
  const key = weekdayKeys[(dayIndex + 6) % 7]
  return {
    key,
    minutes: start.getUTCHours() * 60 + start.getUTCMinutes(),
  }
}

function segmentTowerHoursByWeekday(lines: string[]) {
  const byDay = new Map<WeekdayKey, { raw: string[]; intervals: AirportTowerHoursInterval[] }>()
  for (const key of weekdayKeys) {
    byDay.set(key, { raw: [], intervals: [] })
  }

  for (const line of lines) {
    const normalized = line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    if (!normalized) {
      continue
    }

    const dayMatches = [...normalized.matchAll(/\b(MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(MON|TUE|WED|THU|FRI|SAT|SUN))?/gi)]
    if (dayMatches.length === 0) {
      const targetDays = /\b(DAILY|DLY|EVERY DAY)\b/i.test(normalized) || parseTimeIntervals(normalized).length > 0 || /\bH24\b/i.test(normalized)
        ? weekdayKeys
        : []
      const intervals = parseTimeIntervals(normalized)
      const raw = normalizeAirportHoursDisplayValue(normalized)
      for (const day of targetDays) {
        const item = byDay.get(day)
        if (raw) {
          item?.raw.push(raw)
        }
        item?.intervals.push(...intervals)
      }
      continue
    }

    for (let index = 0; index < dayMatches.length; index += 1) {
      const match = dayMatches[index]
      const from = match[1].toUpperCase() as WeekdayKey
      const to = (match[2]?.toUpperCase() as WeekdayKey | undefined) ?? from
      const nextMatch = dayMatches[index + 1]
      const segmentStart = match.index == null ? 0 : match.index + match[0].length
      const segmentEnd = nextMatch?.index ?? normalized.length
      const segment = normalized.slice(segmentStart, segmentEnd).trim()
      const raw = normalizeAirportHoursDisplayValue(segment)
      const intervals = parseTimeIntervals(segment)

      for (const day of getWeekdayRange(from, to)) {
        const item = byDay.get(day)
        if (raw) {
          item?.raw.push(raw)
        }
        item?.intervals.push(...intervals)
      }
    }
  }

  return byDay
}

function buildAirportTowerHoursDays(
  lines: string[],
  date: string,
  plannedStartTime: string,
): AirportTowerHoursDay[] {
  if (lines.length === 0) {
    return []
  }

  const plannedStart = getPlannedStartWeekday(date, plannedStartTime)
  const byDay = segmentTowerHoursByWeekday(lines)

  return weekdayKeys.map((key) => {
    const item = byDay.get(key)
    const raw = item?.raw.length ? item.raw.join(' / ') : 'Stängt'
    const intervals = item?.intervals ?? []
    const isCurrentDay = plannedStart?.key === key
    const isOpenAtStart = plannedStart && isCurrentDay
      ? intervals.some((interval) => plannedStart.minutes >= interval.startMinutes && plannedStart.minutes < interval.endMinutes)
      : false
    const status: AirportTowerHoursDay['status'] = isCurrentDay
      ? intervals.length > 0
        ? isOpenAtStart ? 'open' : 'closed'
        : raw === 'Stängt' ? 'closed' : 'unknown'
      : null

    return {
      key,
      label: weekdayLabels[key],
      raw,
      intervals,
      isCurrentDay,
      status,
    }
  })
}

function buildAirportServiceHoursSchedule(
  rawText: string | null,
  date: string,
  plannedStartTime: string,
): AirportServiceHoursSchedule | null {
  const sections = getAirportServiceHoursSections(rawText)
  const twrSection = sections.find((section) => section.kind === 'TWR')
  const afisSection = sections.find((section) => section.kind === 'AFIS')

  if (!twrSection && !afisSection) {
    return null
  }

  if (twrSection && afisSection) {
    const twrDays = buildAirportTowerHoursDays(twrSection.lines, date, plannedStartTime)
    const afisDays = buildAirportTowerHoursDays(afisSection.lines, date, plannedStartTime)
    return {
      title: 'TWR öppet',
      days: mergeAirportHoursDays(twrDays, afisDays, 'AFIS'),
    }
  }

  if (twrSection) {
    return {
      title: 'TWR öppet',
      days: buildAirportTowerHoursDays(twrSection.lines, date, plannedStartTime),
    }
  }

  return {
    title: 'AFIS öppet',
    days: buildAirportTowerHoursDays(afisSection?.lines ?? [], date, plannedStartTime),
  }
}

function AirportTowerHoursTable({
  days,
  compact = false,
}: {
  days: AirportTowerHoursDay[]
  compact?: boolean
}) {
  if (days.length === 0) {
    return null
  }

  return (
    <table className={`fp-airport-hours-table ${compact ? 'fp-airport-hours-table--compact' : ''}`}>
      <tbody>
        {days.map((day) => (
          <tr
            key={day.key}
            className={[
              day.isCurrentDay ? 'is-current-day' : '',
              day.status === 'open' ? 'is-open' : '',
              day.status === 'closed' ? 'is-closed' : '',
              day.status === 'unknown' ? 'is-unknown' : '',
            ].filter(Boolean).join(' ')}
          >
            <th scope="row">{day.label}</th>
            <td>{day.raw}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export type FlightplanMapViewport = {
  center: [number, number]
  zoom: number
}

const emptyPlanViewport: FlightplanMapViewport = {
  center: [64.9, 16.8],
  zoom: 5,
}

function getNavaidPalette(kind: SwedishNavaid['kind']) {
  switch (kind) {
    case 'VOR':
      return { color: '#0c5a9a', fillColor: '#d9eeff', radius: 5 }
    case 'DMEV':
      return { color: '#6d3bb3', fillColor: '#eadcff', radius: 5 }
    case 'DME':
      return { color: '#7f4a12', fillColor: '#ffe7c9', radius: 4.5 }
    case 'NDB':
      return { color: '#0f6a41', fillColor: '#d9f6e6', radius: 4.5 }
    default:
      return { color: '#4a5560', fillColor: '#eef2f4', radius: 4.5 }
  }
}

function getVisualPointPalette(kind: SwedishVisualPoint['kind']) {
  if (kind === 'holding') {
    return { color: '#9a5b00', fillColor: '#ffd36a', radius: 4.8, marker: 'H' }
  }

  return { color: '#006b78', fillColor: '#8be7ee', radius: 4.4, marker: 'I' }
}

function getVisualPointKindLabel(kind: SwedishVisualPoint['kind']) {
  return kind === 'holding' ? 'Väntläge' : 'In-/utpassering'
}

function getVisualPointDisplayLabel(point: SwedishVisualPoint) {
  if (point.kind === 'holding') {
    return point.name ?? point.location ?? point.positionIndicator ?? 'HOLD'
  }

  return point.location ?? point.name ?? point.positionIndicator ?? 'ENTRY'
}

function createVisualRoutePoint(point: SwedishVisualPoint) {
  return {
    lat: point.lat,
    lon: point.lon,
    name: getVisualPointDisplayLabel(point),
  }
}

function parseAirspaceAltitudeFeet(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim().toUpperCase()
  if (normalized === 'GND') {
    return 0
  }

  const flightLevelMatch = normalized.match(/^FL\s*(\d+)$/)
  if (flightLevelMatch) {
    return Number(flightLevelMatch[1]) * 100
  }

  const feetMatch = normalized.match(/^(\d+)$/)
  if (feetMatch) {
    return Number(feetMatch[1])
  }

  return null
}

function compareAirspaceAltitude(a: string | null, b: string | null) {
  const aFeet = parseAirspaceAltitudeFeet(a)
  const bFeet = parseAirspaceAltitudeFeet(b)

  if (aFeet == null && bFeet == null) {
    return 0
  }

  if (aFeet == null) {
    return 1
  }

  if (bFeet == null) {
    return -1
  }

  return aFeet - bFeet
}

function pointInRing(lat: number, lon: number, ring: number[][]) {
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function pointInPolygon(lat: number, lon: number, polygon: number[][][]) {
  if (polygon.length === 0) {
    return false
  }

  if (!pointInRing(lat, lon, polygon[0])) {
    return false
  }

  for (const hole of polygon.slice(1)) {
    if (pointInRing(lat, lon, hole)) {
      return false
    }
  }

  return true
}

function polygonRingBounds(ring: number[][]) {
  return L.latLngBounds(ring.map(([lon, lat]) => [lat, lon] as [number, number]))
}

function geometryBounds(geometry: SwedishAirspaceGeometry) {
  if (geometry.type === 'Polygon') {
    return polygonRingBounds(geometry.coordinates[0] ?? [])
  }

  return L.latLngBounds(geometry.coordinates.flatMap((polygon) =>
    (polygon[0] ?? []).map(([lon, lat]) => [lat, lon] as [number, number]),
  ))
}

function boundsIntersection(left: L.LatLngBounds, right: L.LatLngBounds) {
  if (!left.intersects(right)) {
    return null
  }

  const south = Math.max(left.getSouth(), right.getSouth())
  const west = Math.max(left.getWest(), right.getWest())
  const north = Math.min(left.getNorth(), right.getNorth())
  const east = Math.min(left.getEast(), right.getEast())

  if (south > north || west > east) {
    return null
  }

  return L.latLngBounds([south, west], [north, east])
}

function pointInBoundsWithPadding(point: [number, number], bounds: L.LatLngBounds) {
  return bounds.pad(-labelBoundsPaddingRatio).contains(point) || bounds.contains(point)
}

function polygonLabelCandidateDistance(point: [number, number], target: L.LatLng) {
  return L.latLng(point).distanceTo(target)
}

function samplePolygonLabelPosition(
  polygon: number[][][],
  searchBounds: L.LatLngBounds,
  target: L.LatLng,
) {
  const steps = 12
  const candidates: [number, number][] = []
  const south = searchBounds.getSouth()
  const west = searchBounds.getWest()
  const latSpan = searchBounds.getNorth() - south
  const lonSpan = searchBounds.getEast() - west

  for (let latIndex = 0; latIndex <= steps; latIndex += 1) {
    for (let lonIndex = 0; lonIndex <= steps; lonIndex += 1) {
      const lat = south + (latSpan * latIndex) / steps
      const lon = west + (lonSpan * lonIndex) / steps
      if (pointInPolygon(lat, lon, polygon)) {
        candidates.push([lat, lon])
      }
    }
  }

  return candidates
    .sort((left, right) => polygonLabelCandidateDistance(left, target) - polygonLabelCandidateDistance(right, target))[0] ?? null
}

function isLargeEnoughForAirspaceLabel(bounds: L.LatLngBounds, map: L.Map | null) {
  if (!map || !bounds.isValid()) {
    return false
  }

  const northWest = map.latLngToContainerPoint(bounds.getNorthWest())
  const southEast = map.latLngToContainerPoint(bounds.getSouthEast())
  return Math.max(
    Math.abs(southEast.x - northWest.x),
    Math.abs(southEast.y - northWest.y),
  ) >= airspaceLabelMinSizePx
}

function getPolygonLabelPosition(
  polygon: number[][][],
  mapBounds: L.LatLngBounds,
) {
  const outerRing = polygon[0]
  if (!outerRing || outerRing.length === 0) {
    return null
  }

  const polygonBounds = polygonRingBounds(outerRing)
  if (!polygonBounds.intersects(mapBounds)) {
    return null
  }

  const polygonCenter = polygonBounds.getCenter()
  if (
    mapBounds.contains(polygonBounds.getSouthWest()) &&
    mapBounds.contains(polygonBounds.getNorthEast()) &&
    pointInPolygon(polygonCenter.lat, polygonCenter.lng, polygon)
  ) {
    return [polygonCenter.lat, polygonCenter.lng] as [number, number]
  }

  const visibleBounds = boundsIntersection(polygonBounds, mapBounds)
  const mapCenter = mapBounds.getCenter()
  const candidates = [
    [mapCenter.lat, mapCenter.lng] as [number, number],
    visibleBounds
      ? [visibleBounds.getCenter().lat, visibleBounds.getCenter().lng] as [number, number]
      : null,
    [polygonCenter.lat, polygonCenter.lng] as [number, number],
    ...outerRing.map(([lon, lat]) => [lat, lon] as [number, number]),
  ].filter((point): point is [number, number] => Boolean(point))

  const visibleCandidates = candidates.filter(
    ([lat, lon]) => mapBounds.contains([lat, lon]) && pointInPolygon(lat, lon, polygon),
  )
  if (visibleCandidates.length > 0) {
    return visibleCandidates
      .map((point) => ({ point, distance: polygonLabelCandidateDistance(point, mapCenter) }))
      .sort((left, right) => left.distance - right.distance)[0].point
  }

  if (visibleBounds) {
    return samplePolygonLabelPosition(polygon, visibleBounds, mapCenter)
  }

  return null
}

function getAirspaceGeometryLabelPosition(
  geometry: SwedishAirspaceGeometry,
  mapBounds: L.LatLngBounds,
) {
  const positions = geometry.type === 'Polygon'
    ? [getPolygonLabelPosition(geometry.coordinates, mapBounds)]
    : geometry.coordinates.map((polygon) => getPolygonLabelPosition(polygon, mapBounds))

  const mapCenter = mapBounds.getCenter()
  return positions
    .filter((position): position is [number, number] => Boolean(position))
    .sort((left, right) => L.latLng(left).distanceTo(mapCenter) - L.latLng(right).distanceTo(mapCenter))[0] ?? null
}

function getNotamAreaLabelPosition(
  feature: NotamMapOverlayFeature,
  mapBounds: L.LatLngBounds,
) {
  if (feature.kind === 'circle' && feature.radiusNm != null) {
    const [lat, lon] = feature.positions[0] ?? []
    if (lat == null || lon == null) {
      return null
    }

    const center = L.latLng(lat, lon)
    const circleBounds = center.toBounds(feature.radiusNm * 1852 * 2)
    if (!circleBounds.intersects(mapBounds)) {
      return null
    }

    if (mapBounds.contains(circleBounds.getSouthWest()) && mapBounds.contains(circleBounds.getNorthEast())) {
      return [lat, lon] as [number, number]
    }

    const visibleBounds = boundsIntersection(circleBounds, mapBounds)
    if (!visibleBounds) {
      return null
    }

    const visibleCenter = visibleBounds.getCenter()
    return [visibleCenter.lat, visibleCenter.lng] as [number, number]
  }

  if (feature.kind !== 'polygon' || feature.positions.length < 3) {
    return null
  }

  const polygon = [feature.positions.map(([lat, lon]) => [lon, lat])]
  return getPolygonLabelPosition(polygon, mapBounds)
}

function getNotamAreaBounds(feature: NotamMapOverlayFeature) {
  if (feature.kind === 'circle' && feature.radiusNm != null) {
    const [lat, lon] = feature.positions[0] ?? []
    if (lat == null || lon == null) {
      return null
    }

    return L.latLng(lat, lon).toBounds(feature.radiusNm * 1852 * 2)
  }

  if (feature.kind !== 'polygon' || feature.positions.length < 3) {
    return null
  }

  return L.latLngBounds(feature.positions)
}

function pointToSegmentDistanceNm(
  lat: number,
  lon: number,
  from: [number, number],
  to: [number, number],
) {
  const refLatRad = (lat * Math.PI) / 180
  const x = (valueLon: number) => (valueLon - lon) * 60 * Math.cos(refLatRad)
  const y = (valueLat: number) => (valueLat - lat) * 60
  const ax = x(from[1])
  const ay = y(from[0])
  const bx = x(to[1])
  const by = y(to[0])
  const dx = bx - ax
  const dy = by - ay
  const segmentLengthSquared = dx * dx + dy * dy

  if (segmentLengthSquared === 0) {
    return Math.hypot(ax, ay)
  }

  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / segmentLengthSquared))
  return Math.hypot(ax + dx * t, ay + dy * t)
}

function distanceToNotamLineNm(lat: number, lon: number, positions: [number, number][]) {
  if (positions.length === 0) {
    return null
  }

  if (positions.length === 1) {
    const [pointLat, pointLon] = positions[0]
    return distanceNmBetween(lat, lon, pointLat, pointLon)
  }

  let minDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < positions.length; index += 1) {
    minDistance = Math.min(
      minDistance,
      pointToSegmentDistanceNm(lat, lon, positions[index - 1], positions[index]),
    )
  }

  return minDistance
}

function notamFeatureInspectDistanceNm(feature: NotamMapOverlayFeature, lat: number, lon: number) {
  if (feature.kind === 'circle' && feature.radiusNm != null) {
    const [centerLat, centerLon] = feature.positions[0] ?? []
    if (centerLat == null || centerLon == null) {
      return null
    }

    const distanceToCenter = distanceNmBetween(lat, lon, centerLat, centerLon)
    return distanceToCenter <= feature.radiusNm ? 0 : null
  }

  if (feature.kind === 'polygon') {
    if (feature.positions.length < 3) {
      return null
    }

    const polygon = [feature.positions.map(([positionLat, positionLon]) => [positionLon, positionLat])]
    if (pointInPolygon(lat, lon, polygon)) {
      return 0
    }

    const distanceToEdge = distanceToNotamLineNm(lat, lon, feature.positions)
    return distanceToEdge != null && distanceToEdge <= notamLineInspectRadiusNm ? distanceToEdge : null
  }

  if (feature.kind === 'polyline') {
    const distanceToLine = distanceToNotamLineNm(lat, lon, feature.positions)
    return distanceToLine != null && distanceToLine <= notamLineInspectRadiusNm ? distanceToLine : null
  }

  const [pointLat, pointLon] = feature.positions[0] ?? []
  if (pointLat == null || pointLon == null) {
    return null
  }

  const distanceToPoint = distanceNmBetween(lat, lon, pointLat, pointLon)
  return distanceToPoint <= notamPointInspectRadiusNm ? distanceToPoint : null
}

function airspaceContainsPoint(
  airspace: SwedishAirspace,
  lat: number,
  lon: number,
) {
  return geometryContainsPoint(airspace.geometry, lat, lon)
}

function geometryContainsPoint(
  geometry: SwedishAirspaceGeometry,
  lat: number,
  lon: number,
) {
  if (geometry.type === 'Polygon') {
    return pointInPolygon(lat, lon, geometry.coordinates)
  }

  return geometry.coordinates.some((polygon) => pointInPolygon(lat, lon, polygon))
}

function formatAirspaceTooltipContent(
  airspaces: Array<{
    id: string
    kind: string
    name: string | null
    positionIndicator: string | null
    lower: string | null
    upper: string | null
  }>,
) {
  return `<div class="fp-airspace-tooltip">${airspaces.map((airspace) => {
    const title = `${airspace.kind}${airspace.name ? ` · ${airspace.name}` : ''}`
    const indicator = airspace.positionIndicator && airspace.kind !== 'R' && airspace.kind !== 'D'
      ? `<span>${airspace.positionIndicator}</span>`
      : ''
    const levels = `<span>${airspace.lower ?? '—'} till ${airspace.upper ?? '—'}</span>`
    return `<div class="fp-airspace-tooltip__row"><strong>${title}</strong>${indicator}${levels}</div>`
  }).join('')}</div>`
}

function getAirspaceLabelText(airspace: SwedishAirspace) {
  if (airspace.kind === 'CTR' || airspace.kind === 'TMA' || airspace.kind === 'TIA' || airspace.kind === 'TIZ' || airspace.kind === 'ATZ') {
    return null
  }

  const source = airspace.location ?? airspace.name ?? airspace.positionIndicator ?? airspace.id
  return normalizeAirspaceDesignatorLabel(source)
}

function normalizeAirspaceDesignatorLabel(value: string) {
  return value
    .replace(/\bES\s+([RDP])\s*(\d+[A-Z]?)\b/gi, 'ES$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAirspaceDesignatorLabel(value: string) {
  const normalized = value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const match = normalized.match(/\b(ES\s*[RDP]\s*\d{1,4}[A-Z]?)\s+(.+?)(?=\s+(?:ESTABLISHED|UPPRÄTTAD|AREA\b|GRÄNS|BOUNDARY|BOUNDED|WITHIN|WI\b|LOWER:|UPPER:|FROM:|TO:|\d{6}(?:\.\d+)?[NS]|\d{7}(?:\.\d+)?[EW])|[.,;:]|$)/i)
  if (!match?.[1]) {
    return null
  }

  const name = (match[2] ?? '')
    .replace(/\b(?:TEMPORARY|TEMPORÄR|RESTRICTED|DANGER|AREA)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const designator = normalizeAirspaceDesignatorLabel(match[1])
  return name ? `${designator} ${name}` : designator
}

function getNotamAreaLabelText(feature: NotamMapOverlayFeature) {
  return (
    extractAirspaceDesignatorLabel(feature.title) ??
    extractAirspaceDesignatorLabel(feature.rawText) ??
    normalizeAirspaceDesignatorLabel(feature.title)
  )
}

/** Stänger tooltips på alla underlager (GeoJSON, grupper, markörer). Hoppar över permanenta (t.ex. ICAO-etiketter). */
function closeLeafletTooltipsRecursive(layer: L.Layer) {
  if (layer instanceof L.LayerGroup || layer instanceof L.FeatureGroup) {
    layer.eachLayer(closeLeafletTooltipsRecursive)
  } else {
    const tooltip = layer.getTooltip?.()
    if (tooltip?.options.permanent) {
      return
    }

    layer.closeTooltip()
  }
}

function forceCloseAllMapTooltips(map: L.Map) {
  map.eachLayer(closeLeafletTooltipsRecursive)
}

function MapLeafletTooltipCleanup() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()

    const onLeave = () => {
      forceCloseAllMapTooltips(map)
    }

    const onDocumentPointerEnd = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && container.contains(target)) {
        return
      }

      forceCloseAllMapTooltips(map)
    }

    const onWindowBlur = () => {
      forceCloseAllMapTooltips(map)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        forceCloseAllMapTooltips(map)
      }
    }

    const onMapMoveOrZoomStart = () => {
      forceCloseAllMapTooltips(map)
    }

    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('pointerleave', onLeave, true)
    document.addEventListener('pointerup', onDocumentPointerEnd, true)
    document.addEventListener('pointercancel', onDocumentPointerEnd, true)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    map.on('movestart', onMapMoveOrZoomStart)
    map.on('zoomstart', onMapMoveOrZoomStart)

    return () => {
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('pointerleave', onLeave, true)
      document.removeEventListener('pointerup', onDocumentPointerEnd, true)
      document.removeEventListener('pointercancel', onDocumentPointerEnd, true)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      map.off('movestart', onMapMoveOrZoomStart)
      map.off('zoomstart', onMapMoveOrZoomStart)
    }
  }, [map])

  return null
}

function closeLeafletTooltipOnMouseOut(event: { target: L.Layer }) {
  event.target.closeTooltip()
}

function isCoarsePointerInput() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
}

function midpoint(a: FlightPlanInput['routeLegs'][number]['from'], b: FlightPlanInput['routeLegs'][number]['to']) {
  return {
    lat: (a.lat + b.lat) / 2,
    lon: (a.lon + b.lon) / 2,
  }
}

function projectedMidpoint(
  map: L.Map | null,
  a: FlightPlanInput['routeLegs'][number]['from'],
  b: FlightPlanInput['routeLegs'][number]['to'],
) {
  if (!map) {
    return midpoint(a, b)
  }

  const fromPoint = map.latLngToLayerPoint([a.lat, a.lon])
  const toPoint = map.latLngToLayerPoint([b.lat, b.lon])
  const centerPoint = L.point(
    (fromPoint.x + toPoint.x) / 2,
    (fromPoint.y + toPoint.y) / 2,
  )
  const centerLatLng = map.layerPointToLatLng(centerPoint)

  return {
    lat: centerLatLng.lat,
    lon: centerLatLng.lng,
  }
}

function projectedOffsetMidpoint(
  map: L.Map | null,
  a: FlightPlanInput['routeLegs'][number]['from'],
  b: FlightPlanInput['routeLegs'][number]['to'],
  offsetPx: number,
) {
  if (!map) {
    return midpoint(a, b)
  }

  const fromPoint = map.latLngToLayerPoint([a.lat, a.lon])
  const toPoint = map.latLngToLayerPoint([b.lat, b.lon])
  const dx = toPoint.x - fromPoint.x
  const dy = toPoint.y - fromPoint.y
  const length = Math.hypot(dx, dy)

  if (length < 1e-6) {
    return midpoint(a, b)
  }

  const centerPoint = L.point(
    (fromPoint.x + toPoint.x) / 2,
    (fromPoint.y + toPoint.y) / 2,
  )
  const offsetPoint = L.point(
    centerPoint.x - (dy / length) * offsetPx,
    centerPoint.y + (dx / length) * offsetPx,
  )
  const offsetLatLng = map.layerPointToLatLng(offsetPoint)

  return {
    lat: offsetLatLng.lat,
    lon: offsetLatLng.lng,
  }
}

function projectedOffsetRoutePoint(
  map: L.Map | null,
  a: FlightPlanInput['routeLegs'][number]['from'],
  b: FlightPlanInput['routeLegs'][number]['to'],
  fraction: number,
  offsetPx: number,
) {
  if (!map) {
    return {
      lat: a.lat + (b.lat - a.lat) * fraction,
      lon: a.lon + (b.lon - a.lon) * fraction,
    }
  }

  const fromPoint = map.latLngToLayerPoint([a.lat, a.lon])
  const toPoint = map.latLngToLayerPoint([b.lat, b.lon])
  const dx = toPoint.x - fromPoint.x
  const dy = toPoint.y - fromPoint.y
  const length = Math.hypot(dx, dy)

  if (length < 1e-6) {
    return midpoint(a, b)
  }

  const routePoint = L.point(
    fromPoint.x + dx * fraction,
    fromPoint.y + dy * fraction,
  )
  const offsetPoint = L.point(
    routePoint.x - (dy / length) * offsetPx,
    routePoint.y + (dx / length) * offsetPx,
  )
  const offsetLatLng = map.layerPointToLatLng(offsetPoint)

  return {
    lat: offsetLatLng.lat,
    lon: offsetLatLng.lng,
  }
}

function createPrintRouteLegInfoIcon({
  magneticHeading,
  magneticTrack,
  time,
}: {
  magneticHeading: number | string
  magneticTrack: number | string
  time: string
}) {
  return divIcon({
    className: 'fp-print-route-leg-info-marker',
    html: `<span><strong>MH ${magneticHeading}°</strong><small>MT ${magneticTrack}° · ${time}</small></span>`,
    iconSize: [96, 34],
    iconAnchor: [48, 34],
  })
}

function createChevronIcon(rotationDeg: number) {
  return divIcon({
    className: 'fp-direction-icon',
    html: `
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <g transform="rotate(${rotationDeg - 90} 8 8)">
          <path d="M5 4.5 L11 8 L5 11.5" />
        </g>
      </svg>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

function createWindArrowIcon(directionFromDeg: number, speedKt: number) {
  const rotationDeg = normalizeDegrees(directionFromDeg)
  const roundedSpeedKt = Math.max(0, Math.round(speedKt / 5) * 5)
  const pennants = Math.floor(roundedSpeedKt / 50)
  const remainingAfterPennants = roundedSpeedKt % 50
  const longBarbs = Math.floor(remainingAfterPennants / 10)
  const shortBarb = remainingAfterPennants % 10 >= 5
  const elementSpacing = 4.4
  const firstElementY = 8.5

  const calmWindMarkup =
    roundedSpeedKt < 5
      ? '<circle cx="20" cy="20" r="6.2" />'
      : ''

  const pennantMarkup = Array.from({ length: pennants }, (_, index) => {
    const y = firstElementY + index * elementSpacing
    return `<path d="M20 ${y} L20 ${y + elementSpacing} L29 ${y + elementSpacing - 0.2} Z" />`
  }).join('')

  const fullBarbMarkup = Array.from({ length: longBarbs }, (_, index) => {
    const y = firstElementY + (pennants + index) * elementSpacing
    return `<line x1="20" y1="${y}" x2="29" y2="${y + 4.6}" />`
  }).join('')

  const halfBarbMarkup = shortBarb
    ? (() => {
        const y = firstElementY + (pennants + longBarbs) * elementSpacing
        return `<line x1="20" y1="${y}" x2="25.6" y2="${y + 2.9}" />`
      })()
    : ''

  return divIcon({
    className: 'fp-wind-arrow-icon',
    html: `
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <g transform="rotate(${rotationDeg} 20 20)">
          ${roundedSpeedKt >= 5 ? '<line x1="20" y1="31" x2="20" y2="8" />' : ''}
          ${calmWindMarkup}
          ${pennantMarkup}
          ${fullBarbMarkup}
          ${halfBarbMarkup}
        </g>
      </svg>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

function isPlaceholderLeg(legs: FlightPlanInput['routeLegs']) {
  if (legs.length !== 1) {
    return false
  }

  const [leg] = legs
  return leg.from.lat === leg.to.lat && leg.from.lon === leg.to.lon
}

function MapClickHandler({
  onAddPoint,
  onInspectPoint,
  routeEditingEnabled,
  shouldSuppressClick,
}: {
  onAddPoint: (lat: number, lon: number) => void
  onInspectPoint: (lat: number, lon: number) => void
  routeEditingEnabled: boolean
  shouldSuppressClick: () => boolean
}) {
  useMapEvents({
    click(event) {
      if (shouldSuppressClick()) {
        return
      }
      if (routeEditingEnabled) {
        onAddPoint(event.latlng.lat, event.latlng.lng)
      } else {
        onInspectPoint(event.latlng.lat, event.latlng.lng)
      }
    },
  })

  return null
}

function MapZoomHandler({
  onZoomChange,
}: {
  onZoomChange: (zoom: number) => void
}) {
  useMapEvents({
    zoomend(event) {
      onZoomChange(event.target.getZoom())
    },
  })

  return null
}

function MapViewportHandler({
  onViewportChange,
}: {
  onViewportChange: (viewport: FlightplanMapViewport) => void
}) {
  useMapEvents({
    moveend(event) {
      const centerPoint = event.target.getCenter()
      onViewportChange({
        center: [centerPoint.lat, centerPoint.lng],
        zoom: event.target.getZoom(),
      })
    },
    zoomend(event) {
      const centerPoint = event.target.getCenter()
      onViewportChange({
        center: [centerPoint.lat, centerPoint.lng],
        zoom: event.target.getZoom(),
      })
    },
  })

  return null
}

function MapBoundsHandler({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: L.LatLngBounds) => void
}) {
  const map = useMap()

  useEffect(() => {
    let animationFrameId: number | null = null
    let timeoutId: number | null = null

    const refreshBounds = () => {
      if (animationFrameId != null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        map.invalidateSize({ animate: false })
        onBoundsChange(map.getBounds())
      })
    }

    refreshBounds()
    timeoutId = window.setTimeout(refreshBounds, 120)

    const container = map.getContainer()
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshBounds)
    resizeObserver?.observe(container)
    window.addEventListener('resize', refreshBounds)

    return () => {
      if (animationFrameId != null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
      resizeObserver?.disconnect()
      window.removeEventListener('resize', refreshBounds)
    }
  }, [map, onBoundsChange])

  useMapEvents({
    moveend(event) {
      onBoundsChange(event.target.getBounds())
    },
    zoomend(event) {
      onBoundsChange(event.target.getBounds())
    },
  })

  return null
}

function FocusLegHandler({
  plan,
  focusedLegIndex,
}: {
  plan: FlightPlanInput
  focusedLegIndex: number | null
}) {
  const map = useMap()

  useEffect(() => {
    if (focusedLegIndex == null) {
      return
    }

    const leg = plan.routeLegs[focusedLegIndex]
    if (!leg) {
      return
    }

    const bounds = L.latLngBounds(
      [leg.from.lat, leg.from.lon],
      [leg.to.lat, leg.to.lon],
    )

    map.fitBounds(bounds.pad(0.45), {
      animate: true,
      duration: 0.7,
    })
  }, [focusedLegIndex, map, plan.routeLegs])

  return null
}

function InitialViewportHandler({
  waypoints,
  focusedLegIndex,
  initialViewport,
  printMode = false,
}: {
  waypoints: FlightPlanInput['routeLegs'][number]['from'][]
  focusedLegIndex: number | null
  initialViewport: FlightplanMapViewport | null
  printMode?: boolean
}) {
  const map = useMap()
  const didApplyInitialViewport = useRef(false)

  useEffect(() => {
    if (didApplyInitialViewport.current || focusedLegIndex != null) {
      return
    }

    if (initialViewport) {
      map.setView(initialViewport.center, initialViewport.zoom, {
        animate: false,
      })
    } else if (waypoints.length >= 2) {
      const bounds = L.latLngBounds(waypoints.map((point) => [point.lat, point.lon] as [number, number]))
      map.fitBounds(bounds.pad(printMode ? 0.14 : 0.3), {
        animate: false,
      })
    } else {
      map.setView(emptyPlanViewport.center, emptyPlanViewport.zoom, {
        animate: false,
      })
    }

    didApplyInitialViewport.current = true
  }, [focusedLegIndex, initialViewport, map, printMode, waypoints])

  return null
}

function PrintMapLayoutHandler({
  waypoints,
}: {
  waypoints: FlightPlanInput['routeLegs'][number]['from'][]
}) {
  const map = useMap()

  useEffect(() => {
    const fitPrintMap = () => {
      map.invalidateSize({ animate: false })

      if (waypoints.length >= 2) {
        const bounds = L.latLngBounds(waypoints.map((point) => [point.lat, point.lon] as [number, number]))
        map.fitBounds(bounds, {
          animate: false,
          paddingTopLeft: [130, 115],
          paddingBottomRight: [130, 115],
        })
      } else if (waypoints.length === 1) {
        map.setView([waypoints[0].lat, waypoints[0].lon], 9, {
          animate: false,
        })
      }
    }

    const scheduleFit = () => {
      fitPrintMap()
      window.setTimeout(fitPrintMap, 80)
      window.setTimeout(fitPrintMap, 250)
      window.setTimeout(fitPrintMap, 600)
    }

    scheduleFit()

    const container = map.getContainer()
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleFit)
    resizeObserver?.observe(container)

    window.addEventListener('beforeprint', scheduleFit)
    window.addEventListener('afterprint', scheduleFit)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('beforeprint', scheduleFit)
      window.removeEventListener('afterprint', scheduleFit)
    }
  }, [map, waypoints])

  return null
}

function MapInstanceHandler({
  onReady,
}: {
  onReady: (map: L.Map | null) => void
}) {
  const map = useMap()

  useEffect(() => {
    onReady(map)
    return () => onReady(null)
  }, [map, onReady])

  return null
}

function RouteInsertDragHandler({
  activeSegmentIndex,
  onMove,
  onEnd,
}: {
  activeSegmentIndex: number | null
  onMove: (lat: number, lon: number) => void
  onEnd: (lat: number, lon: number) => void
}) {
  useMapEvents({
    mousemove(event) {
      if (activeSegmentIndex == null) {
        return
      }

      onMove(event.latlng.lat, event.latlng.lng)
    },
    mouseup(event) {
      if (activeSegmentIndex == null) {
        return
      }

      onEnd(event.latlng.lat, event.latlng.lng)
    },
  })

  return null
}

function RouteInsertTouchDragHandler({
  enabled,
  routeSegmentCount,
  onStart,
  onMove,
  onEnd,
}: {
  enabled: boolean
  routeSegmentCount: number
  onStart: (segmentIndex: number, lat: number, lon: number) => void
  onMove: (lat: number, lon: number) => void
  onEnd: (lat: number, lon: number) => void
}) {
  const map = useMap()

  useEffect(() => {
    if (!enabled || routeSegmentCount === 0) {
      return
    }

    const container = map.getContainer()
    let removeDocumentListeners: (() => void) | null = null

    const touchToLatLng = (touch: Touch) =>
      map.containerPointToLatLng(map.mouseEventToContainerPoint(touch as unknown as MouseEvent))

    const parseRouteSegmentIndex = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return null
      }

      const segmentElement = target.closest('.fp-route-segment')
      const segmentClass = Array.from(segmentElement?.classList ?? [])
        .find((className) => className.startsWith('fp-route-segment--'))
      const segmentIndex = Number(segmentClass?.replace('fp-route-segment--', ''))

      return Number.isInteger(segmentIndex) && segmentIndex >= 0 && segmentIndex < routeSegmentCount
        ? segmentIndex
        : null
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return
      }

      const segmentIndex = parseRouteSegmentIndex(event.target)
      if (segmentIndex == null) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      let latestLatLng = touchToLatLng(event.touches[0])
      onStart(segmentIndex, latestLatLng.lat, latestLatLng.lng)

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.touches.length !== 1) {
          return
        }

        moveEvent.preventDefault()
        moveEvent.stopPropagation()
        latestLatLng = touchToLatLng(moveEvent.touches[0])
        onMove(latestLatLng.lat, latestLatLng.lng)
      }

      const handleTouchEnd = (endEvent: TouchEvent) => {
        endEvent.preventDefault()
        endEvent.stopPropagation()

        if (endEvent.changedTouches.length > 0) {
          latestLatLng = touchToLatLng(endEvent.changedTouches[0])
        }

        removeDocumentListeners?.()
        removeDocumentListeners = null
        onEnd(latestLatLng.lat, latestLatLng.lng)
      }

      const handleTouchCancel = (cancelEvent: TouchEvent) => {
        cancelEvent.preventDefault()
        cancelEvent.stopPropagation()
        removeDocumentListeners?.()
        removeDocumentListeners = null
        onEnd(latestLatLng.lat, latestLatLng.lng)
      }

      removeDocumentListeners?.()
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleTouchEnd, { passive: false })
      document.addEventListener('touchcancel', handleTouchCancel, { passive: false })
      removeDocumentListeners = () => {
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
        document.removeEventListener('touchcancel', handleTouchCancel)
      }
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: false })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      removeDocumentListeners?.()
    }
  }, [enabled, map, onEnd, onMove, onStart, routeSegmentCount])

  return null
}

export function FlightplanMapEditor({
  plan,
  derived,
  aloftWindAutoFetchEnabled = true,
  aloftWinds = [],
  aloftWindStatus = 'idle',
  sigmetText = null,
  notamMapFeatures = [],
  notamMapCoverage = createEmptyNotamMapCoverageCheck(),
  notamMapNotice = null,
  notamMapNoticeLinks = [],
  notamMapStatus = 'idle',
  hudSlot,
  hudTopCenterSlot,
  hudStatusSlot,
  routeEditingEnabled = true,
  onRouteLegsChange,
  focusedLegIndex = null,
  initialViewport = null,
  onViewportChange,
  printMode = false,
}: {
  plan: FlightPlanInput
  derived: FlightPlanDerived
  aloftWindAutoFetchEnabled?: boolean
  aloftWinds?: RouteLegAloftWind[]
  aloftWindStatus?: 'idle' | 'loading' | 'error' | 'ready'
  sigmetText?: string | null
  notamMapFeatures?: NotamMapOverlayFeature[]
  notamMapCoverage?: NotamMapCoverageCheck
  notamMapNotice?: string | null
  notamMapNoticeLinks?: NotamMapNoticeLink[]
  notamMapStatus?: 'idle' | 'loading' | 'error' | 'ready'
  hudSlot?: ReactNode
  hudTopCenterSlot?: ReactNode
  hudStatusSlot?: ReactNode
  routeEditingEnabled?: boolean
  onRouteLegsChange: (legs: FlightPlanInput['routeLegs']) => void
  focusedLegIndex?: number | null
  initialViewport?: FlightplanMapViewport | null
  onViewportChange?: (viewport: FlightplanMapViewport) => void
  printMode?: boolean
}) {
  const swedishAirspaces = getSwedishAirspaces()
  const swedishAirports = getSwedishAirports()
  const swedishNavaids = getSwedishNavaids()
  const swedishVisualPoints = getSwedishVisualPoints()
  const [basemap, setBasemap] = useState<BasemapKey>(readStoredBasemap)
  const [mapLayerPreferences, setMapLayerPreferences] = useState(readStoredMapLayerPreferences)
  const [isMapLayerMenuOpen, setIsMapLayerMenuOpen] = useState(false)
  const [mapZoom, setMapZoom] = useState(7)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null)
  const [selectedPointInfo, setSelectedPointInfo] = useState<MapPointInfo | null>(null)
  const [dragPreviewWaypoints, setDragPreviewWaypoints] = useState<ReturnType<typeof legsToWaypoints> | null>(null)
  const [activeSegmentInsertIndex, setActiveSegmentInsertIndex] = useState<number | null>(null)
  const activeSegmentInsertIndexRef = useRef<number | null>(null)
  const [hoveredAirspaceIds, setHoveredAirspaceIds] = useState<string[]>([])
  const [hoveredNotamFeature, setHoveredNotamFeature] = useState<NotamMapOverlayFeature | null>(null)
  const [airportNotamByIcao, setAirportNotamByIcao] = useState<Record<string, AirportNotamLookup>>({})
  const [openNotamMapNoticeKey, setOpenNotamMapNoticeKey] = useState<string | null>(null)
  const [waypointMarkerLayerVersion, setWaypointMarkerLayerVersion] = useState(0)
  const [airportWeatherByIcao, setAirportWeatherByIcao] = useState<Record<string, AirportMapWeather>>({})
  const [obstacles, setObstacles] = useState<SwedishObstacle[]>([])
  const [obstacleStatus, setObstacleStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [obstacleFetchResult, setObstacleFetchResult] = useState<{ totalFeatures: number | null; numberReturned: number | null } | null>(null)
  const [metarStaleCheckTick, setMetarStaleCheckTick] = useState(0)
  const airportWeatherByIcaoRef = useRef(airportWeatherByIcao)
  const suppressNextMapClick = useRef(false)
  const mapLayerMenuRef = useRef<HTMLDivElement | null>(null)
  const notamPanelHideTimeoutRef = useRef<number | null>(null)
  const pendingAirportNotamRef = useRef(new Set<string>())
  const pendingAirportWeatherRef = useRef(new Set<string>())
  const mapCanvasRef = useRef<HTMLDivElement | null>(null)
  const [printMapSizeKey, setPrintMapSizeKey] = useState('print-map-initial')
  const isMapbox3dBasemap = isMapbox3dBasemapKey(basemap)
  const showAirspaces = mapLayerPreferences.airspaces
  const showWeatherOverlays = mapLayerPreferences.weatherOverlays
  const showNotamOverlays = mapLayerPreferences.notamOverlays
  const showAloftWindArrows = mapLayerPreferences.aloftWindArrows
  const showNavaids = mapLayerPreferences.navaids
  const showVisualPoints = mapLayerPreferences.visualPoints
  const showObstacles = mapLayerPreferences.obstacles
  const showAirports = mapLayerPreferences.airports
  const showMetar = mapLayerPreferences.metar
  const showTaf = mapLayerPreferences.taf
  const showAirportWeather = showMetar || showTaf
  const showAirportMarkers = showAirports || showAirportWeather
  const airportFlightCategories = useMemo<Record<string, FlightplanMapboxAirportFlightCategory>>(() => {
    if (!showAirportWeather) {
      return {}
    }

    const categories: Record<string, FlightplanMapboxAirportFlightCategory> = {}
    for (const airport of swedishAirports) {
      if (!airport.icao) {
        continue
      }

      categories[airport.icao] = getAirportDisplayFlightRules(airportWeatherByIcao[airport.icao] ?? null, { showMetar, showTaf }).category
    }
    return categories
  }, [airportWeatherByIcao, showAirportWeather, showMetar, showTaf, swedishAirports])
  const enabledLayerCount = Object.values(mapLayerPreferences).filter(Boolean).length
  const notamLayerMeta = notamMapStatus === 'ready'
    ? formatNotamMapCoverageLabel(notamMapCoverage)
    : 'En-route och NAV-varningar'
  const activeBasemap = basemaps[basemap]
  const hasNotamMapNotice = Boolean(notamMapNotice)
  const notamMapNoticeKey = notamMapNotice
    ? `${notamMapNotice}|${notamMapNoticeLinks.map((link) => `${link.label}:${link.href}`).join('|')}`
    : null
  const isNotamMapNoticeOpen = notamMapNoticeKey != null && openNotamMapNoticeKey === notamMapNoticeKey
  const hasPendingStartPoint = useMemo(() => isPlaceholderLeg(plan.routeLegs), [plan.routeLegs])
  const waypoints = useMemo(() => {
    if (hasPendingStartPoint) {
      return plan.routeLegs.length > 0 ? [plan.routeLegs[0].from] : []
    }

    return legsToWaypoints(plan.routeLegs)
  }, [hasPendingStartPoint, plan.routeLegs])
  const displayWaypoints = dragPreviewWaypoints ?? waypoints
  const previewRouteLegs = useMemo(
    () => (displayWaypoints.length < 2 ? [] : waypointsToLegs(displayWaypoints, plan.routeLegs, DEFAULT_ROUTE_TAS_KT)),
    [displayWaypoints, plan.routeLegs],
  )
  const previewRouteLegsWithVariation = useMemo(() => {
    const magneticVariations = calculateRouteLegMagneticVariations(
      previewRouteLegs,
      plan.header.date,
      plan.header.plannedStartTime,
    )

    return previewRouteLegs.map((leg, index) =>
      magneticVariations[index]
        ? {
            ...leg,
            variation: magneticVariations[index].declination,
          }
        : leg,
    )
  }, [plan.header.date, plan.header.plannedStartTime, previewRouteLegs])
  const previewDerived = useMemo(
    () => calculateFlightPlan({ ...plan, routeLegs: previewRouteLegsWithVariation }, [derived.aircraft]),
    [derived.aircraft, plan, previewRouteLegsWithVariation],
  )
  const center = useMemo<[number, number]>(() => {
    if (displayWaypoints.length === 0) {
      return [62.0, 17.5]
    }

    const avgLat = displayWaypoints.reduce((sum, point) => sum + point.lat, 0) / displayWaypoints.length
    const avgLon = displayWaypoints.reduce((sum, point) => sum + point.lon, 0) / displayWaypoints.length
    return [avgLat, avgLon]
  }, [displayWaypoints])
  const airspaceGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: swedishAirspaces
        .filter((airspace) => {
          const lowerFeet = parseAirspaceAltitudeFeet(airspace.lower)
          return lowerFeet == null || lowerFeet < maxVisibleAirspaceLowerFt
        })
        .map((airspace) => ({
          type: 'Feature' as const,
          properties: {
            id: airspace.id,
            kind: airspace.kind,
            name: airspace.name,
            lower: airspace.lower,
            upper: airspace.upper,
            positionIndicator: airspace.positionIndicator,
          },
          geometry: airspace.geometry,
        })),
    }),
    [swedishAirspaces],
  )
  const highlightedAirspaceGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: airspaceGeoJson.features.filter((feature) => hoveredAirspaceIds.includes(feature.properties.id)),
    }),
    [airspaceGeoJson, hoveredAirspaceIds],
  )
  const visibleAirspaces = useMemo(
    () =>
      swedishAirspaces
        .filter((airspace) => {
          const lowerFeet = parseAirspaceAltitudeFeet(airspace.lower)
          return lowerFeet == null || lowerFeet < maxVisibleAirspaceLowerFt
        }),
    [swedishAirspaces],
  )
  const routeWeatherOverlays = useMemo<RouteWeatherOverlay[]>(
    () => getAllWeatherOverlays(sigmetText),
    [sigmetText],
  )
  const visibleWeatherAirports = useMemo<NearbyAirport[]>(() => {
    if (!showAirportMarkers) {
      return []
    }

    if (!mapBounds) {
      return []
    }

    const paddedBounds = mapBounds.pad(0.2)

    const boundsCenter = paddedBounds.getCenter()

    return swedishAirports
      .filter((airport): airport is SwedishAirport & { icao: string; name: string } => Boolean(airport.icao && airport.name))
      .filter((airport) => paddedBounds.contains([airport.lat, airport.lon]))
      .sort((left, right) =>
        distanceNmBetween(boundsCenter.lat, boundsCenter.lng, left.lat, left.lon) -
        distanceNmBetween(boundsCenter.lat, boundsCenter.lng, right.lat, right.lon),
      )
      .map((airport) => ({
        ...airport,
        distanceNm: 0,
      }))
  }, [mapBounds, showAirportMarkers, swedishAirports])
  const visibleVisualPoints = useMemo(() => {
    if (!showVisualPoints || mapZoom < visualPointMinZoom) {
      return []
    }

    if (!mapBounds) {
      return swedishVisualPoints
    }

    const paddedBounds = mapBounds.pad(0.1)
    return swedishVisualPoints.filter((point) => paddedBounds.contains([point.lat, point.lon]))
  }, [mapBounds, mapZoom, showVisualPoints, swedishVisualPoints])
  const visibleObstacles = useMemo(() => {
    if (!showObstacles || mapZoom < obstacleMinZoom) {
      return []
    }

    if (!mapBounds) {
      return obstacles
    }

    const paddedBounds = mapBounds.pad(0.08)
    return obstacles.filter((obstacle) => paddedBounds.contains([obstacle.lat, obstacle.lon]))
  }, [mapBounds, mapZoom, obstacles, showObstacles])
  const obstacleLayerMeta = (() => {
    if (mapZoom < obstacleMinZoom) {
      return `LFV från zoom ${obstacleMinZoom}`
    }

    if (obstacleStatus === 'loading') {
      return 'Hämtar LFV flyghinder...'
    }

    if (obstacleStatus === 'error') {
      return 'LFV kunde inte laddas'
    }

    if (obstacleStatus === 'ready') {
      const returned = obstacleFetchResult?.numberReturned ?? visibleObstacles.length
      const total = obstacleFetchResult?.totalFeatures
      return total != null && returned < total ? `${returned}/${total} i vy` : `${visibleObstacles.length} i vy`
    }

    return 'LFV OBSE'
  })()
  const airspaceLabels = useMemo<AirspaceMapLabel[]>(() => {
    if (isMapbox3dBasemap || !mapBounds || !mapInstance || mapZoom < airspaceLabelMinZoom) {
      return []
    }

    const labels: AirspaceMapLabel[] = []

    if (showAirspaces) {
      for (const airspace of visibleAirspaces) {
        const label = getAirspaceLabelText(airspace)
        if (!label) {
          continue
        }

        if (!isLargeEnoughForAirspaceLabel(geometryBounds(airspace.geometry), mapInstance)) {
          continue
        }

        const position = getAirspaceGeometryLabelPosition(airspace.geometry, mapBounds)
        if (!position || !pointInBoundsWithPadding(position, mapBounds)) {
          continue
        }

        labels.push({
          id: `airspace-${airspace.id}`,
          label,
          position,
          variant: `airspace-${airspace.kind.toLowerCase()}`,
        })
      }
    }

    if (showNotamOverlays) {
      for (const feature of notamMapFeatures) {
        if (feature.source !== 'aip-sup') {
          continue
        }

        if (mapInstance && shouldCollapseNotamAreaToPoint(feature, mapInstance, mapZoom)) {
          continue
        }

        const bounds = getNotamAreaBounds(feature)
        if (!bounds || !isLargeEnoughForAirspaceLabel(bounds, mapInstance)) {
          continue
        }

        const position = getNotamAreaLabelPosition(feature, mapBounds)
        if (!position || !pointInBoundsWithPadding(position, mapBounds)) {
          continue
        }

        labels.push({
          id: `notam-${feature.id}`,
          label: getNotamAreaLabelText(feature),
          position,
          variant: `notam-${feature.source}`,
        })
      }
    }

    return labels
  }, [isMapbox3dBasemap, mapBounds, mapInstance, mapZoom, notamMapFeatures, showAirspaces, showNotamOverlays, visibleAirspaces])
  const isAirspaceLabelHighlighted = (label: AirspaceMapLabel) => {
    if (label.id.startsWith('airspace-')) {
      return hoveredAirspaceIds.includes(label.id.replace(/^airspace-/, ''))
    }

    return hoveredNotamFeature != null && label.id === `notam-${hoveredNotamFeature.id}`
  }
  const visibleWeatherAirportKey = useMemo(
    () => visibleWeatherAirports.map((airport) => airport.icao).sort((left, right) => left.localeCompare(right, 'sv')).join(','),
    [visibleWeatherAirports],
  )

  const visibleWeatherAirportsRef = useRef(visibleWeatherAirports)

  useEffect(() => {
    window.localStorage.setItem(mapLayerPreferencesStorageKey, JSON.stringify(mapLayerPreferences))
  }, [mapLayerPreferences])

  useEffect(() => {
    window.localStorage.setItem(mapBasemapStorageKey, basemap)
  }, [basemap])

  useEffect(() => {
    airportWeatherByIcaoRef.current = airportWeatherByIcao
  }, [airportWeatherByIcao])

  useEffect(() => {
    if (!showObstacles || !mapBounds || mapZoom < obstacleMinZoom) {
      setObstacles([])
      setObstacleFetchResult(null)
      setObstacleStatus('idle')
      return
    }

    const controller = new AbortController()
    const paddedBounds = mapBounds.pad(0.15)
    const timeoutId = window.setTimeout(() => {
      setObstacleStatus('loading')
      fetchSwedishObstacles(
        {
          south: paddedBounds.getSouth(),
          west: paddedBounds.getWest(),
          north: paddedBounds.getNorth(),
          east: paddedBounds.getEast(),
        },
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted) {
            return
          }

          setObstacles(result.obstacles)
          setObstacleFetchResult({
            totalFeatures: result.totalFeatures,
            numberReturned: result.numberReturned,
          })
          setObstacleStatus('ready')
        })
        .catch((error) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            return
          }

          setObstacles([])
          setObstacleFetchResult(null)
          setObstacleStatus('error')
        })
    }, 450)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [mapBounds, mapZoom, showObstacles])

  useEffect(() => {
    visibleWeatherAirportsRef.current = visibleWeatherAirports
  }, [visibleWeatherAirports])

  useEffect(() => {
    if (!printMode) {
      return
    }

    const element = mapCanvasRef.current
    if (!element) {
      return
    }

    let animationFrameId: number | null = null

    const updateSizeKey = () => {
      if (animationFrameId != null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        const rect = element.getBoundingClientRect()
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)

        if (width > 0 && height > 0) {
          setPrintMapSizeKey(`print-map-${width}x${height}`)
        }
      })
    }

    updateSizeKey()

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateSizeKey)
    resizeObserver?.observe(element)
    window.addEventListener('beforeprint', updateSizeKey)

    return () => {
      if (animationFrameId != null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      resizeObserver?.disconnect()
      window.removeEventListener('beforeprint', updateSizeKey)
    }
  }, [printMode])

  useEffect(() => {
    return () => {
      if (notamPanelHideTimeoutRef.current != null) {
        window.clearTimeout(notamPanelHideTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isMapLayerMenuOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && mapLayerMenuRef.current?.contains(target)) {
        return
      }

      setIsMapLayerMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMapLayerMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isMapLayerMenuOpen])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMetarStaleCheckTick((tick) => tick + 1)
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!showAirportMarkers) {
      return
    }

    const visible = visibleWeatherAirportsRef.current
    if (visible.length === 0) {
      return
    }

    const byIcao = airportWeatherByIcaoRef.current
    const includeTaf = true

    const airportsToFetch = visible.filter((airport) => {
      const pendingKey = `${airport.icao}:metar`
      if (pendingAirportWeatherRef.current.has(pendingKey)) {
        return false
      }

      return needsAirportWeatherRefetchForMap(byIcao[airport.icao], includeTaf)
    })

    if (airportsToFetch.length === 0) {
      return
    }

    for (const airport of airportsToFetch) {
      pendingAirportWeatherRef.current.add(`${airport.icao}:metar`)
    }

    const controller = new AbortController()
    let cancelled = false

    const loadAirportWeather = async () => {
      try {
        const results = await fetchMapWeatherForAirports(airportsToFetch, controller.signal, includeTaf)

        if (cancelled || controller.signal.aborted) {
          return
        }

        setAirportWeatherByIcao((current) => {
          const next = { ...current }
          const storedAt = Date.now()
          for (const result of results) {
            next[result.airport.icao] = {
              ...next[result.airport.icao],
              ...result,
              cachedAtMs: storedAt,
              tafRawText: next[result.airport.icao]?.tafRawText ?? result.tafRawText,
              tafIssuedAt: next[result.airport.icao]?.tafIssuedAt ?? result.tafIssuedAt,
              tafCachedAtMs: next[result.airport.icao]?.tafCachedAtMs ?? storedAt,
            }
          }
          return next
        })
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== 'AbortError') {
          console.error('Kunde inte hämta kartväder för flygplatser.', error)
        }
      } finally {
        for (const airport of airportsToFetch) {
          pendingAirportWeatherRef.current.delete(`${airport.icao}:metar`)
        }
      }
    }

    void loadAirportWeather()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [showAirportMarkers, visibleWeatherAirportKey, metarStaleCheckTick])

  useEffect(() => {
    if (!showAirportMarkers) {
      return
    }

    const visible = visibleWeatherAirportsRef.current
    if (visible.length === 0) {
      return
    }

    const now = Date.now()
    const byIcao = airportWeatherByIcaoRef.current
    const airportsToFetch = visible.filter((airport) => {
      const cached = byIcao[airport.icao]
      const pendingKey = `${airport.icao}:taf`
      if (pendingAirportWeatherRef.current.has(pendingKey)) {
        return false
      }

      return !cached?.tafRawText && (cached?.tafCachedAtMs == null || now - cached.tafCachedAtMs > WEATHER_MAP_CACHE_MAX_AGE_MS)
    })

    if (airportsToFetch.length === 0) {
      return
    }

    for (const airport of airportsToFetch) {
      pendingAirportWeatherRef.current.add(`${airport.icao}:taf`)
    }

    const controller = new AbortController()
    let cancelled = false

    const loadAirportTaf = async () => {
      try {
        const results = await fetchMapWeatherForAirports(airportsToFetch, controller.signal, true)

        if (cancelled || controller.signal.aborted) {
          return
        }

        setAirportWeatherByIcao((current) => {
          const next = { ...current }
          const storedAt = Date.now()
          for (const result of results) {
            next[result.airport.icao] = {
              ...next[result.airport.icao],
              ...result,
              cachedAtMs: next[result.airport.icao]?.cachedAtMs ?? storedAt,
              tafCachedAtMs: storedAt,
            }
          }
          return next
        })
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== 'AbortError') {
          console.error('Kunde inte hämta TAF för kartflygplatser.', error)
        }
      } finally {
        for (const airport of airportsToFetch) {
          pendingAirportWeatherRef.current.delete(`${airport.icao}:taf`)
        }
      }
    }

    void loadAirportTaf()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [showAirportMarkers, visibleWeatherAirportKey, metarStaleCheckTick])

  useEffect(() => {
    setSelectedPointInfo((current) => {
      if (!current || current.airports.length === 0) {
        return current
      }

      return {
        ...current,
        airports: current.airports.map((airport) => {
          if (!airport.icao) {
            return airport
          }

          return {
            ...airport,
            weatherLines: getAirportTooltipWeatherLines(airportWeatherByIcao[airport.icao] ?? null),
          }
        }),
      }
    })
  }, [airportWeatherByIcao])

  const buildPointInfo = (
    lat: number,
    lon: number,
    directObjects: MapPointInfoDirectObjects = {},
  ): MapPointInfo => {
    const matchingAirspaces = visibleAirspaces
      .filter((airspace) => airspaceContainsPoint(airspace, lat, lon))
      .map((airspace) => ({
        id: airspace.id,
        kind: airspace.kind,
        name: airspace.name,
        positionIndicator: airspace.positionIndicator,
        lower: airspace.lower,
        upper: airspace.upper,
      }))
      .sort((a, b) => compareAirspaceAltitude(b.upper, a.upper) || compareAirspaceAltitude(b.lower, a.lower))

    const notamFeaturesAtPoint = showNotamOverlays
      ? notamMapFeatures
          .map((feature) => {
            const distanceNm = notamFeatureInspectDistanceNm(feature, lat, lon)
            return distanceNm == null ? null : { feature, distanceNm }
          })
          .filter((item): item is PointInfoNotamFeature => Boolean(item))
          .sort((left, right) => left.distanceNm - right.distanceNm || left.feature.title.localeCompare(right.feature.title, 'sv'))
          .slice(0, 8)
      : []
    const nearbyObstacles = showObstacles
      ? visibleObstacles
          .map((obstacle) => ({
            obstacle,
            distanceNm: distanceNmBetween(lat, lon, obstacle.lat, obstacle.lon),
          }))
          .filter((item) => item.distanceNm <= obstacleInspectRadiusNm)
          .sort((left, right) =>
            left.distanceNm - right.distanceNm ||
            getObstacleDisplayType(left.obstacle).localeCompare(getObstacleDisplayType(right.obstacle), 'sv'),
          )
          .slice(0, 10)
      : []

    return {
      lat,
      lon,
      coordinateLabel: `${formatCoordinateDms(lat, 'lat')} ${formatCoordinateDms(lon, 'lon')}`,
      airspaces: matchingAirspaces,
      airports: directObjects.airports ?? [],
      navaids: directObjects.navaids ?? [],
      visualPoints: directObjects.visualPoints ?? [],
      obstacles: nearbyObstacles,
      notamFeatures: directObjects.notamFeatures ?? notamFeaturesAtPoint,
    }
  }

  const inspectPoint = (lat: number, lon: number, directObjects?: MapPointInfoDirectObjects) => {
    setSelectedPointInfo(buildPointInfo(lat, lon, directObjects))
  }

  const getAirportNotamLookup = (icao: string | null) => {
    if (!icao) {
      return null
    }

    return airportNotamByIcao[icao] ?? { status: 'idle' }
  }

  const buildAirportPointInfo = (
    airport: SwedishAirport,
    adNotam: AirportNotamLookup | null = getAirportNotamLookup(airport.icao),
  ): PointInfoAirport => {
    const weather = airport.icao ? airportWeatherByIcao[airport.icao] : null
    const serviceHoursSchedule = adNotam?.status === 'ready'
      ? buildAirportServiceHoursSchedule(
          adNotam.entry?.rawText ?? null,
          plan.header.date,
          plan.header.plannedStartTime,
        )
      : null

    return {
      id: airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`,
      icao: airport.icao,
      label: airport.icao ?? airport.name ?? 'Flygplats',
      name: airport.name ?? '',
      distanceNm: 0,
      weatherLines: getAirportTooltipWeatherLines(weather),
      serviceHoursSchedule,
      adNotam,
    }
  }

  const updateSelectedAirportNotam = (icao: string, lookup: AirportNotamLookup) => {
    setSelectedPointInfo((current) => {
      if (!current?.airports.some((item) => item.icao === icao)) {
        return current
      }

      const airport = swedishAirports.find((item) => item.icao === icao)
      if (!airport) {
        return current
      }

      return {
        ...current,
        airports: current.airports.map((item) => (
          item.icao === icao ? buildAirportPointInfo(airport, lookup) : item
        )),
      }
    })
  }

  const loadAirportNotam = (airport: SwedishAirport): AirportNotamLookup | null => {
    if (!airport.icao) {
      return null
    }

    const existing = airportNotamByIcao[airport.icao]
    if (existing?.status === 'loading' || existing?.status === 'ready' || pendingAirportNotamRef.current.has(airport.icao)) {
      return existing ?? { status: 'loading' }
    }

    const icao = airport.icao
    const loadingLookup: AirportNotamLookup = { status: 'loading' }
    pendingAirportNotamRef.current.add(icao)
    setAirportNotamByIcao((current) => ({
      ...current,
      [icao]: loadingLookup,
    }))
    updateSelectedAirportNotam(icao, loadingLookup)

    fetchNotamsForAirports([icao])
      .then((response) => {
        const entry = response.notams.find((result) => result.icao === icao) ?? null
        const lookup: AirportNotamLookup = { status: 'ready', entry }
        setAirportNotamByIcao((current) => ({
          ...current,
          [icao]: lookup,
        }))
        updateSelectedAirportNotam(icao, lookup)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Kunde inte hämta AD-NOTAM.'
        const lookup: AirportNotamLookup = { status: 'error', error: message }
        setAirportNotamByIcao((current) => ({
          ...current,
          [icao]: lookup,
        }))
        updateSelectedAirportNotam(icao, lookup)
      })
      .finally(() => {
        pendingAirportNotamRef.current.delete(icao)
      })

    return loadingLookup
  }

  const inspectAirport = (airport: SwedishAirport) => {
    const adNotam = loadAirportNotam(airport)
    inspectPoint(airport.lat, airport.lon, {
      airports: [buildAirportPointInfo(airport, adNotam)],
    })
  }

  const inspectNavaid = (navaid: SwedishNavaid) => {
    inspectPoint(navaid.lat, navaid.lon, {
      navaids: [{
        id: navaid.id,
        label: navaid.ident ?? navaid.name ?? navaid.kind,
        kind: navaid.kind,
        frequency: navaid.frequency,
        channel: navaid.channel,
        distanceNm: 0,
      }],
    })
  }

  const inspectVisualPoint = (point: SwedishVisualPoint) => {
    inspectPoint(point.lat, point.lon, {
      visualPoints: [{
        id: point.id,
        label: getVisualPointDisplayLabel(point),
        kind: point.kind,
        positionIndicator: point.positionIndicator,
        location: point.location,
        distanceNm: 0,
      }],
    })
  }

  const inspectNotamFeature = (feature: NotamMapOverlayFeature, lat: number, lon: number) => {
    inspectPoint(lat, lon, {
      notamFeatures: [{ feature, distanceNm: 0 }],
    })
  }

  const inspectNotamLeafletPoint = (feature: NotamMapOverlayFeature) => (event: LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(event.originalEvent)
    suppressNextMapClick.current = true
    inspectNotamFeature(feature, event.latlng.lat, event.latlng.lng)
  }

  const setWaypoints = (nextWaypoints: typeof waypoints) => {
    setDragPreviewWaypoints(null)
    activeSegmentInsertIndexRef.current = null
    setActiveSegmentInsertIndex(null)
    const nextLegs = waypointsToLegs(nextWaypoints, plan.routeLegs, DEFAULT_ROUTE_TAS_KT)
    onRouteLegsChange(nextLegs)
  }

  const toggleMapLayerPreference = (key: MapLayerPreferenceKey) => {
    setMapLayerPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  const showNotamInfoPanel = (feature: NotamMapOverlayFeature) => {
    if (notamPanelHideTimeoutRef.current != null) {
      window.clearTimeout(notamPanelHideTimeoutRef.current)
      notamPanelHideTimeoutRef.current = null
    }

    setHoveredNotamFeature(feature)
  }

  const scheduleHideNotamInfoPanel = (featureId: string) => {
    if (notamPanelHideTimeoutRef.current != null) {
      window.clearTimeout(notamPanelHideTimeoutRef.current)
    }

    notamPanelHideTimeoutRef.current = window.setTimeout(() => {
      setHoveredNotamFeature((current) => (current?.id === featureId ? null : current))
      notamPanelHideTimeoutRef.current = null
    }, 180)
  }

  const shouldSuppressClick = () => {
    if (!suppressNextMapClick.current) {
      return false
    }

    suppressNextMapClick.current = false
    return true
  }

  const resolveRoutePoint = (lat: number, lon: number) => {
    const coordinatePoint = pointWithNearestName(lat, lon)

    if (!mapInstance) {
      return coordinatePoint
    }

    const cursorPoint = mapInstance.latLngToLayerPoint([lat, lon])

    for (const airport of swedishAirports) {
      if (!airport.icao) {
        continue
      }

      const airportPoint = mapInstance.latLngToLayerPoint([airport.lat, airport.lon])
      if (cursorPoint.distanceTo(airportPoint) <= airportMarkerRadiusPx) {
        return {
          lat: airport.lat,
          lon: airport.lon,
          name: airport.icao,
        }
      }
    }

    return coordinatePoint
  }

  const addPointToEnd = (lat: number, lon: number) => {
    if (!routeEditingEnabled) {
      inspectPoint(lat, lon)
      return
    }

    setSelectedPointInfo(null)
    const nextPoint = resolveRoutePoint(lat, lon)
    if (waypoints.length === 0) {
      onRouteLegsChange([
        {
          from: nextPoint,
          to: nextPoint,
          windDirection: aloftWindAutoFetchEnabled ? 220 : 0,
          windSpeedKt: aloftWindAutoFetchEnabled ? 15 : 0,
          tasKt: DEFAULT_ROUTE_TAS_KT,
          variation: 0,
          altitude: "3000'",
          navRef: '',
          notes: '',
        },
      ])
      return
    }

    if (isPlaceholderLeg(plan.routeLegs)) {
      onRouteLegsChange([
        {
          ...plan.routeLegs[0],
          from: { ...plan.routeLegs[0].from },
          to: nextPoint,
        },
      ])
      return
    }

    setWaypoints([...waypoints, nextPoint])
  }

  const addNavaidPointToEnd = (navaid: SwedishNavaid) => {
    if (!routeEditingEnabled) {
      inspectNavaid(navaid)
      return
    }

    setSelectedPointInfo(null)
    const resolvedPoint = resolveRoutePoint(navaid.lat, navaid.lon)
    const nextLabel = navaid.ident ?? navaid.name ?? navaid.kind
    const nextPoint =
      resolvedPoint.lat === navaid.lat && resolvedPoint.lon === navaid.lon
        ? {
            lat: navaid.lat,
            lon: navaid.lon,
            name: nextLabel,
          }
        : resolvedPoint

    if (waypoints.length === 0) {
      onRouteLegsChange([
        {
          from: nextPoint,
          to: nextPoint,
          windDirection: aloftWindAutoFetchEnabled ? 220 : 0,
          windSpeedKt: aloftWindAutoFetchEnabled ? 15 : 0,
          tasKt: DEFAULT_ROUTE_TAS_KT,
          variation: 0,
          altitude: "3000'",
          navRef: '',
          notes: '',
        },
      ])
      return
    }

    if (isPlaceholderLeg(plan.routeLegs)) {
      onRouteLegsChange([
        {
          ...plan.routeLegs[0],
          from: { ...plan.routeLegs[0].from },
          to: nextPoint,
        },
      ])
      return
    }

    setWaypoints([...waypoints, nextPoint])
  }

  const addVisualPointToEnd = (point: SwedishVisualPoint) => {
    if (!routeEditingEnabled) {
      inspectVisualPoint(point)
      return
    }

    setSelectedPointInfo(null)
    const nextPoint = createVisualRoutePoint(point)

    if (waypoints.length === 0) {
      onRouteLegsChange([
        {
          from: nextPoint,
          to: nextPoint,
          windDirection: aloftWindAutoFetchEnabled ? 220 : 0,
          windSpeedKt: aloftWindAutoFetchEnabled ? 15 : 0,
          tasKt: DEFAULT_ROUTE_TAS_KT,
          variation: 0,
          altitude: "3000'",
          navRef: '',
          notes: '',
        },
      ])
      return
    }

    if (isPlaceholderLeg(plan.routeLegs)) {
      onRouteLegsChange([
        {
          ...plan.routeLegs[0],
          from: { ...plan.routeLegs[0].from },
          to: nextPoint,
        },
      ])
      return
    }

    setWaypoints([...waypoints, nextPoint])
  }

  const previewMoveWaypoint = (index: number, lat: number, lon: number) => {
    setDragPreviewWaypoints(
      waypoints.map((point, pointIndex) =>
        pointIndex === index ? resolveRoutePoint(lat, lon) : point,
      ),
    )
  }

  const updateWaypoint = (index: number, lat: number, lon: number) => {
    const next = waypoints.map((point, pointIndex) =>
      pointIndex === index ? resolveRoutePoint(lat, lon) : point,
    )
    setWaypoints(next)
  }

  const previewInsertWaypointAt = (index: number, lat: number, lon: number) => {
    const next = [...waypoints]
    next.splice(index, 0, resolveRoutePoint(lat, lon))
    setDragPreviewWaypoints(next)
  }

  const insertWaypointAt = (index: number, lat: number, lon: number) => {
    const next = [...waypoints]
    next.splice(index, 0, resolveRoutePoint(lat, lon))
    setWaypoints(next)
  }

  const startSegmentInsertDrag = (segmentIndex: number, lat: number, lon: number) => {
    if (!routeEditingEnabled) {
      return
    }

    suppressNextMapClick.current = true
    activeSegmentInsertIndexRef.current = segmentIndex + 1
    setActiveSegmentInsertIndex(segmentIndex + 1)

    if (mapInstance) {
      mapInstance.dragging.disable()
    }

    previewInsertWaypointAt(segmentIndex + 1, lat, lon)
  }

  const updateSegmentInsertDrag = (lat: number, lon: number) => {
    const activeIndex = activeSegmentInsertIndexRef.current ?? activeSegmentInsertIndex
    if (activeIndex == null) {
      return
    }

    setDragPreviewWaypoints((current) => {
      if (!current) {
        const next = [...waypoints]
        next.splice(activeIndex, 0, resolveRoutePoint(lat, lon))
        return next
      }

      return current.map((point, pointIndex) =>
        pointIndex === activeIndex ? resolveRoutePoint(lat, lon) : point,
      )
    })
  }

  const endSegmentInsertDrag = (lat: number, lon: number) => {
    const activeIndex = activeSegmentInsertIndexRef.current ?? activeSegmentInsertIndex
    if (activeIndex == null) {
      return
    }

    if (mapInstance) {
      mapInstance.dragging.enable()
    }

    insertWaypointAt(activeIndex, lat, lon)
  }

  const removeWaypoint = (index: number) => {
    if (!routeEditingEnabled) {
      return
    }

    if (waypoints.length <= 2) {
      return
    }
    setWaypointMarkerLayerVersion((current) => current + 1)
    setWaypoints(waypoints.filter((_, pointIndex) => pointIndex !== index))
  }

  const shouldShowDirectionArrow = (leg: typeof previewRouteLegs[number]) => {
    if (!mapInstance) {
      return true
    }

    const arrowPoint = projectedMidpoint(mapInstance, leg.from, leg.to)
    const arrowLayerPoint = mapInstance.latLngToLayerPoint([arrowPoint.lat, arrowPoint.lon])

    return !displayWaypoints.some((waypoint) => {
      const waypointLayerPoint = mapInstance.latLngToLayerPoint([waypoint.lat, waypoint.lon])
      return arrowLayerPoint.distanceTo(waypointLayerPoint) < directionArrowWaypointClearancePx
    })
  }

  return (
    <section className={`fp-map-editor${printMode ? ' fp-map-editor--print' : ''}`}>
      <div className="fp-map-canvas" ref={mapCanvasRef}>
        {!printMode ? <div className={`fp-map-hud-row ${isMapLayerMenuOpen ? 'fp-map-hud-row--layer-menu-open' : ''} ${hudTopCenterSlot ? 'fp-map-hud-row--with-open-plan' : ''}`}>
          <div className="fp-map-hud fp-map-hud--top-right">
            <div className="fp-map-controls">
              {hasNotamMapNotice ? (
                <button
                  type="button"
                  className={`fp-notam-map-warning-button ${isNotamMapNoticeOpen ? 'is-open' : ''}`}
                  aria-label={isNotamMapNoticeOpen ? 'Dölj NOTAM/AIP SUP-varning' : 'Visa NOTAM/AIP SUP-varning'}
                  aria-expanded={isNotamMapNoticeOpen}
                  onClick={() => {
                    setIsMapLayerMenuOpen(false)
                    setOpenNotamMapNoticeKey((current) => (
                      current === notamMapNoticeKey ? null : notamMapNoticeKey
                    ))
                  }}
                >
                  <span className="fp-notam-map-warning-button__triangle" aria-hidden="true" />
                </button>
              ) : null}
              <div className="fp-map-layer-menu" ref={mapLayerMenuRef}>
                <button
                  type="button"
                  className="fp-map-layer-menu__button fp-map-layer-menu__button--hamburger"
                  aria-haspopup="menu"
                  aria-expanded={isMapLayerMenuOpen}
                  onClick={() => setIsMapLayerMenuOpen((open) => !open)}
                  aria-label="Öppna visningsmeny"
                >
                  <span className="fp-map-layer-menu__button-main">
                    <span className="fp-map-layer-menu__hamburger" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="fp-map-layer-menu__label">Visning</span>
                  </span>
                  <span className="fp-map-layer-menu__count">{enabledLayerCount}/10</span>
                </button>
                {isMapLayerMenuOpen ? (
                <div className="fp-map-layer-menu__popover" role="menu" aria-label="Kartdata">
                  <div className="fp-map-layer-menu__header">
                    <strong>Visning</strong>
                  </div>
                  <div className="fp-map-layer-menu__section">
                    <label className="fp-basemap-control fp-basemap-control--menu">
                      Kartlager
                      <select value={basemap} onChange={(event) => setBasemap(event.target.value as BasemapKey)}>
                        {Object.entries(basemaps).map(([key, config]) => (
                          <option key={key} value={key}>
                            {config.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {notamMapNotice != null || notamMapStatus !== 'idle' ? (
                      <span className="fp-notam-map-toolbar-status fp-notam-map-toolbar-status--menu" aria-live="polite">
                        {notamMapStatus === 'loading' ? 'Hämtar NOTAM & AIP SUP...' : null}
                        {notamMapStatus === 'error' ? 'NOTAM kunde inte laddas' : null}
                      </span>
                    ) : null}
                  </div>
                  <div className="fp-map-layer-menu__header fp-map-layer-menu__header--section">
                    <strong>Visa i kartan</strong>
                  </div>
                  <MapLayerSwitch
                    checked={showAirspaces}
                    label="Luftrum"
                    meta="CTR, TMA, R/D, TRA"
                    onToggle={() => toggleMapLayerPreference('airspaces')}
                  />
                  <MapLayerSwitch
                    checked={showWeatherOverlays}
                    label="Väderområden"
                    meta={`SIGMET/ARS/AIRMET (${routeWeatherOverlays.length})`}
                    onToggle={() => toggleMapLayerPreference('weatherOverlays')}
                  />
                  <MapLayerSwitch
                    checked={showNotamOverlays}
                    disabled={notamMapStatus === 'loading'}
                    label="NOTAM / AIP SUP"
                    meta={notamLayerMeta}
                    onToggle={() => toggleMapLayerPreference('notamOverlays')}
                  />
                  <MapLayerSwitch
                    checked={showAloftWindArrows}
                    label="Höjdvindar"
                    meta={
                      aloftWindStatus === 'loading'
                        ? 'Open-Meteo uppdaterar höjdvind'
                        : aloftWinds.length > 0
                          ? `Open-Meteo längs rutten (${aloftWinds.length})`
                          : 'Open-Meteo höjdvind längs rutten'
                    }
                    onToggle={() => toggleMapLayerPreference('aloftWindArrows')}
                  />
                  <MapLayerSwitch
                    checked={showNavaids}
                    label="Navhjälpmedel"
                    meta="VOR, DME, NDB, waypoints"
                    onToggle={() => toggleMapLayerPreference('navaids')}
                  />
                  <MapLayerSwitch
                    checked={showVisualPoints}
                    label="Inpassering & vänt"
                    meta={`Entry/exit och VFR holdings från zoom ${visualPointMinZoom}`}
                    onToggle={() => toggleMapLayerPreference('visualPoints')}
                  />
                  <MapLayerSwitch
                    checked={showObstacles}
                    disabled={obstacleStatus === 'loading'}
                    label="Flyghinder"
                    meta={obstacleLayerMeta}
                    onToggle={() => toggleMapLayerPreference('obstacles')}
                  />
                  <MapLayerSwitch
                    checked={showAirports}
                    label="Flygplatser"
                    meta="Markörer och ICAO-etiketter"
                    onToggle={() => toggleMapLayerPreference('airports')}
                  />
                  <MapLayerSwitch
                    checked={showMetar}
                    label="METAR"
                    meta="Observation och flygregelkategori"
                    onToggle={() => toggleMapLayerPreference('metar')}
                  />
                  <MapLayerSwitch
                    checked={showTaf}
                    label="TAF"
                    meta="Prognos och flygregelkategori"
                    onToggle={() => toggleMapLayerPreference('taf')}
                  />
                </div>
              ) : null}
            </div>
          </div>
          {notamMapNotice && isNotamMapNoticeOpen ? (
            <div className="fp-notam-map-banner" role="status">
              <span>{notamMapNotice}</span>
              {notamMapNoticeLinks.length > 0 ? (
                <span className="fp-notam-map-banner__links">
                  {notamMapNoticeLinks.map((link) => (
                    <a key={`${link.label}-${link.href}`} href={link.href} target="_blank" rel="noreferrer">
                      {link.label}
                    </a>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}
          </div>
          {hudSlot ? <div className="fp-map-hud fp-map-hud--top-left fp-map-hud--editor">{hudSlot}</div> : null}
          {hudTopCenterSlot ? <div className="fp-map-hud fp-map-hud--top-center">{hudTopCenterSlot}</div> : null}
        </div> : null}
        {!printMode && hudStatusSlot ? <div className="fp-map-hud fp-map-hud--bottom-center fp-map-hud--status">{hudStatusSlot}</div> : null}
        {selectedPointInfo ? (
          <aside className="fp-map-point-info-panel" role="status" aria-live="polite">
            <div className="fp-map-point-info-panel__header">
              <div>
                <p>Vad finns här?</p>
                <strong>{selectedPointInfo.coordinateLabel}</strong>
              </div>
              <button type="button" aria-label="Stäng punktinformation" onClick={() => setSelectedPointInfo(null)}>
                x
              </button>
            </div>

            <section>
              <h3>Luftrum</h3>
              {selectedPointInfo.airspaces.length > 0 ? (
                <ul>
                  {selectedPointInfo.airspaces.map((airspace) => (
                    <li key={airspace.id}>
                      <strong>{airspace.kind}{airspace.name ? ` · ${airspace.name}` : ''}</strong>
                      <span>{airspace.lower ?? '-'} till {airspace.upper ?? '-'}</span>
                      {airspace.positionIndicator ? <span>{airspace.positionIndicator}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Inga visade luftrum över punkten.</p>
              )}
            </section>

            {selectedPointInfo.airports.length > 0 ? (
              <section>
                <h3>Flygplats</h3>
                <ul>
                  {selectedPointInfo.airports.map((airport) => (
                    <li key={airport.id}>
                      <strong>{airport.label}</strong>
                      {airport.name ? <span>{airport.name}</span> : null}
                      <span>{formatDistanceNm(airport.distanceNm)}</span>
                      {airport.weatherLines.slice(0, 2).map((line) => (
                        <small key={line}>{line}</small>
                      ))}
                      {airport.serviceHoursSchedule ? (
                        <div className="fp-map-point-info-panel__airport-hours">
                          <span>{airport.serviceHoursSchedule.title}</span>
                          <AirportTowerHoursTable days={airport.serviceHoursSchedule.days} />
                        </div>
                      ) : null}
                      {airport.adNotam ? (
                        <div className="fp-map-point-info-panel__airport-notam">
                          <span>AD-NOTAM</span>
                          {airport.adNotam.status === 'loading' ? <small>Hämtar AD-NOTAM...</small> : null}
                          {airport.adNotam.status === 'error' ? <small>{airport.adNotam.error}</small> : null}
                          {airport.adNotam.status === 'ready' && airport.adNotam.entry?.rawText ? (
                            <pre>{formatNotamText(airport.adNotam.entry.rawText)}</pre>
                          ) : null}
                          {airport.adNotam.status === 'ready' && !airport.adNotam.entry?.rawText ? (
                            <small>Inga AD-NOTAM i aktuell LFV-briefing.</small>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selectedPointInfo.visualPoints.length > 0 ? (
              <section>
                <h3>Inpassering och väntläge</h3>
                <ul>
                  {selectedPointInfo.visualPoints.map((point) => (
                    <li key={point.id}>
                      <strong>{point.label}</strong>
                      <span>{getVisualPointKindLabel(point.kind)} · {formatDistanceNm(point.distanceNm)}</span>
                      {point.positionIndicator ? <span>{point.positionIndicator}</span> : null}
                      {point.location && point.location !== point.label ? <span>{point.location}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selectedPointInfo.navaids.length > 0 ? (
              <section>
                <h3>Navhjälpmedel</h3>
                <ul>
                  {selectedPointInfo.navaids.map((navaid) => (
                    <li key={navaid.id}>
                      <strong>{navaid.label}</strong>
                      <span>{navaid.kind} · {formatDistanceNm(navaid.distanceNm)}</span>
                      {navaid.frequency ? <span>{navaid.frequency}</span> : null}
                      {navaid.channel ? <span>Kanal {navaid.channel}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selectedPointInfo.obstacles.length > 0 ? (
              <section>
                <h3>Flyghinder</h3>
                <ul>
                  {selectedPointInfo.obstacles.map(({ obstacle, distanceNm }) => (
                    <li key={obstacle.id}>
                      <strong>{getObstacleDisplayType(obstacle)}</strong>
                      {obstacle.name ? <span>{obstacle.name}</span> : null}
                      <span>{formatDistanceNm(distanceNm)}</span>
                      {formatObstacleHeight(obstacle.heightValue, obstacle.heightUnit) ? (
                        <small>Höjd {formatObstacleHeight(obstacle.heightValue, obstacle.heightUnit)}</small>
                      ) : null}
                      {formatObstacleHeight(obstacle.mslValue, obstacle.mslUnit) ? (
                        <small>MSL {formatObstacleHeight(obstacle.mslValue, obstacle.mslUnit)}</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h3>NOTAM / AIP SUP</h3>
              {selectedPointInfo.notamFeatures.length > 0 ? (
                <ul>
                  {selectedPointInfo.notamFeatures.map(({ feature, distanceNm }) => (
                    <li key={feature.id} className="fp-map-point-info-panel__notam-item">
                      <NotamMapInfoCard feature={feature} />
                      {distanceNm > 0 ? <small>{formatDistanceNm(distanceNm)} från punkten</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Inget visat NOTAM- eller AIP SUP-område över punkten.</p>
              )}
            </section>
          </aside>
        ) : null}
        {!printMode && !isMapbox3dBasemap && !routeEditingEnabled && !selectedPointInfo && (
          <div className="fp-map-empty-hint">
            Utforska kartan. Klicka för "Vad finns här?" eller välj Skapa rutt.
          </div>
        )}
        {!printMode && !isMapbox3dBasemap && routeEditingEnabled && waypoints.length === 0 && (
          <div className="fp-map-empty-hint">
            Klicka i kartan för att välja startpunkten
          </div>
        )}
        {!printMode && !isMapbox3dBasemap && routeEditingEnabled && hasPendingStartPoint && (
          <div className="fp-map-empty-hint">
            Startpunkt vald. Klicka igen i kartan för nästa waypoint.
          </div>
        )}
        {isMapbox3dBasemap && !printMode ? (
          <Suspense fallback={<div className="fp-map-empty-hint">Laddar 3D-karta...</div>}>
            <FlightplanMapbox3D
              airspaces={showAirspaces ? visibleAirspaces : []}
              airportFlightCategories={airportFlightCategories}
              airports={showAirportMarkers ? swedishAirports : []}
              aloftWinds={showAloftWindArrows ? aloftWinds : []}
              initialViewport={initialViewport}
              mapStyle={getMapbox3DStyle(basemap)}
              navaids={showNavaids ? swedishNavaids : []}
              notamFeatures={showNotamOverlays ? notamMapFeatures : []}
              obstacles={showObstacles ? visibleObstacles : []}
              onMapViewChange={(view) => {
                setMapBounds(L.latLngBounds(
                  [view.bounds.south, view.bounds.west],
                  [view.bounds.north, view.bounds.east],
                ))
                setMapZoom(view.zoom)
              }}
              onInspectAirport={inspectAirport}
              onInspectNavaid={inspectNavaid}
              onInspectNotamFeature={inspectNotamFeature}
              onInspectPoint={inspectPoint}
              onInspectVisualPoint={inspectVisualPoint}
              plan={plan}
              derived={derived}
              visualPoints={showVisualPoints ? visibleVisualPoints : []}
              weatherOverlays={showWeatherOverlays ? routeWeatherOverlays : []}
            />
          </Suspense>
        ) : (
          <MapContainer
            key={printMode ? printMapSizeKey : 'interactive-map'}
            center={center}
            zoom={7}
            maxZoom={activeBasemap.maxZoom}
            scrollWheelZoom={!printMode}
            zoomControl={false}
            className="fp-leaflet-map"
          >
          <ZoomControl position="topright" />
          <Pane name={notamMapPane} style={{ zIndex: 525 }} />
          <Pane name="fp-navaid-pane" style={{ zIndex: 530 }} />
          <Pane name="fp-visual-point-pane" style={{ zIndex: 535 }} />
          <Pane name={obstacleMapPane} style={{ zIndex: 540 }} />
          <Pane name="fp-wind-pane" style={{ zIndex: 545 }} />
          <Pane name="fp-airspace-label-pane" style={{ zIndex: 555 }} />
          <Pane name={notamMapHighlightPane} style={{ zIndex: 558 }} />
          <Pane name="fp-airport-pane" style={{ zIndex: 560 }} />
          <TileLayer
            attribution={activeBasemap.attribution ?? ''}
            maxNativeZoom={activeBasemap.maxNativeZoom}
            maxZoom={activeBasemap.maxZoom}
            url={activeBasemap.url ?? basemaps.topo.url ?? ''}
          />
          <MapInstanceHandler onReady={setMapInstance} />
          <InitialViewportHandler
            waypoints={displayWaypoints}
            focusedLegIndex={focusedLegIndex}
            initialViewport={initialViewport}
            printMode={printMode}
          />
          {printMode ? <PrintMapLayoutHandler waypoints={displayWaypoints} /> : null}
          <MapClickHandler
            onAddPoint={addPointToEnd}
            onInspectPoint={inspectPoint}
            routeEditingEnabled={routeEditingEnabled}
            shouldSuppressClick={shouldSuppressClick}
          />
          <MapZoomHandler onZoomChange={setMapZoom} />
          <MapBoundsHandler onBoundsChange={setMapBounds} />
          <MapLeafletTooltipCleanup />
          {onViewportChange ? <MapViewportHandler onViewportChange={onViewportChange} /> : null}
          <RouteInsertDragHandler
            activeSegmentIndex={activeSegmentInsertIndex}
            onMove={updateSegmentInsertDrag}
            onEnd={endSegmentInsertDrag}
          />
          <RouteInsertTouchDragHandler
            enabled={routeEditingEnabled}
            routeSegmentCount={previewRouteLegs.length}
            onStart={startSegmentInsertDrag}
            onMove={updateSegmentInsertDrag}
            onEnd={endSegmentInsertDrag}
          />
          <FocusLegHandler plan={plan} focusedLegIndex={focusedLegIndex} />

          {showAirspaces ? (
            <GeoJSON
              data={airspaceGeoJson}
              style={(feature) => getLeafletAirspacePathOptions(feature?.properties?.kind)}
              onEachFeature={(_feature, layer) => {
                layer.bindTooltip('', {
                  sticky: true,
                  opacity: 0.95,
                  offset: [14, -10],
                  className: 'fp-hover-tooltip fp-airspace-tooltip',
                })
                layer.on('mouseover mousemove', (event) => {
                  const pointer = event as LeafletMouseEvent
                  if (isCoarsePointerInput()) {
                    if (layer.isTooltipOpen()) {
                      layer.closeTooltip()
                    }
                    setHoveredAirspaceIds([])
                    return
                  }

                  const matchingAirspaces = visibleAirspaces
                    .filter((airspace) => airspaceContainsPoint(airspace, pointer.latlng.lat, pointer.latlng.lng))
                    .map((airspace) => ({
                      id: airspace.id,
                      kind: airspace.kind,
                      name: airspace.name,
                      positionIndicator: airspace.positionIndicator,
                      lower: airspace.lower,
                      upper: airspace.upper,
                    }))
                    .sort((a, b) => compareAirspaceAltitude(b.upper, a.upper) || compareAirspaceAltitude(b.lower, a.lower))

                  if (matchingAirspaces.length === 0) {
                    if (layer.isTooltipOpen()) {
                      layer.closeTooltip()
                    }
                    setHoveredAirspaceIds([])
                    return
                  }

                  setHoveredAirspaceIds(matchingAirspaces.map((airspace) => airspace.id))
                  layer.setTooltipContent(formatAirspaceTooltipContent(matchingAirspaces))
                  if (!layer.isTooltipOpen()) {
                    layer.openTooltip(pointer.latlng)
                  }
                })
                layer.on('mouseout', () => {
                  layer.closeTooltip()
                  setHoveredAirspaceIds([])
                })
                layer.on('click', (event) => {
                  const clicked = event as LeafletMouseEvent
                  clicked.originalEvent?.preventDefault?.()
                  clicked.originalEvent?.stopPropagation?.()
                  if (isCoarsePointerInput() && layer.isTooltipOpen()) {
                    layer.closeTooltip()
                  }

                  addPointToEnd(clicked.latlng.lat, clicked.latlng.lng)
                })
              }}
            />
          ) : null}

          {showAirspaces && highlightedAirspaceGeoJson.features.length > 0 ? (
            <GeoJSON
              key={hoveredAirspaceIds.join('|')}
              data={highlightedAirspaceGeoJson}
              interactive={false}
              style={(feature) => ({
                ...getLeafletAirspacePathOptions(feature?.properties?.kind, { highlighted: true }),
                className: 'fp-airspace-highlight-path',
              })}
            />
          ) : null}

          {showWeatherOverlays
            ? routeWeatherOverlays.map((overlay) => {
                const tooltipContent = (
                  <Tooltip sticky opacity={0.95} className="fp-hover-tooltip fp-weather-overlay-tooltip">
                    <div className="fp-airport-tooltip fp-weather-overlay-tooltip__content">
                      <strong>{overlay.firCodes[0] ?? 'SIGMET/ARS/AIRMET'}</strong>
                      <span>{overlay.matchSummary}</span>
                      <span>{overlay.title}</span>
                    </div>
                  </Tooltip>
                )

                if (overlay.geometry.type === 'polygon') {
                  return (
                    <Polygon
                      key={overlay.id}
                      positions={overlay.geometry.points.map((point) => [point.lat, point.lon] as [number, number])}
                      smoothFactor={0}
                      pathOptions={{
                        color: sigmetOverlayPalette.color,
                        weight: getOverlayStrokeWeight(mapZoom, 'weather-area'),
                        fillColor: sigmetOverlayPalette.fillColor,
                        fillOpacity: 0.16,
                        dashArray: '6 4',
                      }}
                      eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
                    >
                      {tooltipContent}
                    </Polygon>
                  )
                }

                if (overlay.geometry.type === 'multipolygon') {
                  return (
                    <Polygon
                      key={overlay.id}
                      positions={overlay.geometry.polygons.map((polygon) => (
                        polygon.map((point) => [point.lat, point.lon] as [number, number])
                      ))}
                      smoothFactor={0}
                      pathOptions={{
                        color: sigmetOverlayPalette.color,
                        weight: getOverlayStrokeWeight(mapZoom, 'weather-area'),
                        fillColor: sigmetOverlayPalette.fillColor,
                        fillOpacity: 0.16,
                        dashArray: '6 4',
                      }}
                      eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
                    >
                      {tooltipContent}
                    </Polygon>
                  )
                }

                if (overlay.geometry.type === 'polyline') {
                  return (
                    <Polyline
                      key={overlay.id}
                      positions={overlay.geometry.points.map((point) => [point.lat, point.lon] as [number, number])}
                      smoothFactor={0}
                      pathOptions={{
                        color: sigmetOverlayPalette.lineColor,
                        weight: getOverlayStrokeWeight(mapZoom, 'weather-line'),
                        opacity: 0.95,
                        dashArray: '8 6',
                      }}
                      eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
                    >
                      {tooltipContent}
                    </Polyline>
                  )
                }

                if (overlay.geometry.type === 'circle') {
                  return (
                    <Circle
                      key={overlay.id}
                      center={[overlay.geometry.centre.lat, overlay.geometry.centre.lon]}
                      radius={overlay.geometry.radiusNm * 1852}
                      pathOptions={{
                        color: sigmetOverlayPalette.color,
                        weight: getOverlayStrokeWeight(mapZoom, 'weather-area'),
                        fillColor: sigmetOverlayPalette.fillColor,
                        fillOpacity: 0.12,
                        dashArray: '6 4',
                      }}
                      eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
                    >
                      {tooltipContent}
                    </Circle>
                  )
                }

                return (
                  <CircleMarker
                    key={overlay.id}
                    center={[overlay.geometry.point.lat, overlay.geometry.point.lon]}
                    radius={6}
                    pathOptions={{
                      color: sigmetOverlayPalette.color,
                      weight: 2,
                      fillColor: sigmetOverlayPalette.fillColor,
                      fillOpacity: 0.9,
                    }}
                    eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
                  >
                    {tooltipContent}
                  </CircleMarker>
                )
              })
            : null}

          {showNotamOverlays
            ? notamMapFeatures.map((feature) => {
                const renderAsPoint = shouldCollapseNotamAreaToPoint(feature, mapInstance, mapZoom)

                if (feature.kind === 'circle' && feature.radiusNm != null) {
                  const [lat, lon] = feature.positions[0] ?? [0, 0]
                  if (renderAsPoint) {
                    return (
                      <Marker
                        key={feature.id}
                        pane={notamMapPane}
                        position={[lat, lon]}
                        icon={createNotamMapSymbolIcon(feature.source)}
                        keyboard={false}
                        zIndexOffset={80}
                        eventHandlers={{
                          mouseover: () => showNotamInfoPanel(feature),
                          mouseout: () => scheduleHideNotamInfoPanel(feature.id),
                          click: inspectNotamLeafletPoint(feature),
                        }}
                      />
                    )
                  }

                  return (
                    <Circle
                      key={feature.id}
                      pane={notamMapPane}
                      center={[lat, lon]}
                      radius={feature.radiusNm * 1852}
                      pathOptions={notamMapPathOptions(feature.source, 'area', mapZoom)}
                      eventHandlers={{
                        mouseover: () => showNotamInfoPanel(feature),
                        mouseout: () => scheduleHideNotamInfoPanel(feature.id),
                        click: inspectNotamLeafletPoint(feature),
                      }}
                    />
                  )
                }

                if (feature.kind === 'polygon') {
                  if (renderAsPoint) {
                    const [lat, lon] = getFeatureMarkerPosition(feature)
                    return (
                      <Marker
                        key={feature.id}
                        pane={notamMapPane}
                        position={[lat, lon]}
                        icon={createNotamMapSymbolIcon(feature.source)}
                        keyboard={false}
                        zIndexOffset={80}
                        eventHandlers={{
                          mouseover: () => showNotamInfoPanel(feature),
                          mouseout: () => scheduleHideNotamInfoPanel(feature.id),
                          click: inspectNotamLeafletPoint(feature),
                        }}
                      />
                    )
                  }

                  return (
                    <Polygon
                      key={feature.id}
                      pane={notamMapPane}
                      positions={feature.positions}
                      pathOptions={notamMapPathOptions(feature.source, 'area', mapZoom)}
                      eventHandlers={{
                        mouseover: () => showNotamInfoPanel(feature),
                        mouseout: () => scheduleHideNotamInfoPanel(feature.id),
                        click: inspectNotamLeafletPoint(feature),
                      }}
                    />
                  )
                }

                if (feature.kind === 'polyline') {
                  return (
                    <Polyline
                      key={feature.id}
                      pane={notamMapPane}
                      positions={feature.positions}
                      pathOptions={notamMapPathOptions(feature.source, 'line', mapZoom)}
                      eventHandlers={{
                        mouseover: () => showNotamInfoPanel(feature),
                        mouseout: () => scheduleHideNotamInfoPanel(feature.id),
                        click: inspectNotamLeafletPoint(feature),
                      }}
                    />
                  )
                }

                const [ptLat, ptLon] = feature.positions[0] ?? [0, 0]
                return (
                  <Marker
                    key={feature.id}
                    pane={notamMapPane}
                    position={[ptLat, ptLon]}
                    icon={createNotamMapSymbolIcon(feature.source)}
                    keyboard={false}
                    zIndexOffset={80}
                    eventHandlers={{
                      mouseover: () => showNotamInfoPanel(feature),
                      mouseout: () => scheduleHideNotamInfoPanel(feature.id),
                      click: inspectNotamLeafletPoint(feature),
                    }}
                  />
                )
              })
            : null}

          {showNotamOverlays && hoveredNotamFeature && !shouldCollapseNotamAreaToPoint(hoveredNotamFeature, mapInstance, mapZoom)
            ? (() => {
                const pathOptions = {
                  ...notamMapPathOptions(
                    hoveredNotamFeature.source,
                    hoveredNotamFeature.kind === 'polyline' ? 'line' : 'area',
                    mapZoom,
                  ),
                  fillOpacity: 0,
                  opacity: 1,
                  weight: notamMapPathOptions(
                    hoveredNotamFeature.source,
                    hoveredNotamFeature.kind === 'polyline' ? 'line' : 'area',
                    mapZoom,
                  ).weight + 1.8,
                  className: 'fp-airspace-highlight-path',
                }

                if (hoveredNotamFeature.kind === 'circle' && hoveredNotamFeature.radiusNm != null) {
                  const [lat, lon] = hoveredNotamFeature.positions[0] ?? [0, 0]
                  return (
                    <Circle
                      key={`highlight-${hoveredNotamFeature.id}`}
                      pane={notamMapHighlightPane}
                      center={[lat, lon]}
                      radius={hoveredNotamFeature.radiusNm * 1852}
                      pathOptions={pathOptions}
                      interactive={false}
                    />
                  )
                }

                if (hoveredNotamFeature.kind === 'polygon') {
                  return (
                    <Polygon
                      key={`highlight-${hoveredNotamFeature.id}`}
                      pane={notamMapHighlightPane}
                      positions={hoveredNotamFeature.positions}
                      pathOptions={pathOptions}
                      interactive={false}
                    />
                  )
                }

                if (hoveredNotamFeature.kind === 'polyline') {
                  return (
                    <Polyline
                      key={`highlight-${hoveredNotamFeature.id}`}
                      pane={notamMapHighlightPane}
                      positions={hoveredNotamFeature.positions}
                      pathOptions={pathOptions}
                      interactive={false}
                    />
                  )
                }

                return null
              })()
            : null}

          {showAloftWindArrows
            ? aloftWinds.map((wind, index) => {
                const leg = plan.routeLegs[index]
                if (!leg) {
                  return null
                }

                return (
                  <Marker
                    key={`wind-${index}-${wind.requestedTime}-${wind.altitudeMetersMsl}`}
                    pane="fp-wind-pane"
                    position={(() => {
                      const point = projectedOffsetMidpoint(mapInstance, leg.from, leg.to, 18)
                      return [point.lat, point.lon] as [number, number]
                    })()}
                    icon={createWindArrowIcon(wind.direction, wind.speedKt)}
                    keyboard={false}
                    zIndexOffset={120}
                    eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={0.95} className="fp-hover-tooltip fp-wind-arrow-tooltip">
                      <div className="fp-airport-tooltip fp-wind-arrow-tooltip__content">
                        <strong>{getRoutePointLabel(leg.from)} → {getRoutePointLabel(leg.to)}</strong>
                        <span>Vind {wind.direction}° / {wind.speedKt} kt</span>
                        <span>Höjd {leg.altitude || `${Math.round(wind.altitudeMetersMsl / 0.3048)}'`}</span>
                        <span>{wind.requestedTime.replace('T', ' ')}</span>
                      </div>
                    </Tooltip>
                  </Marker>
                )
              })
            : null}

          {showNavaids && mapZoom >= navaidMinZoom
            ? swedishNavaids.map((navaid) => {
                const palette = getNavaidPalette(navaid.kind)
                const label = navaid.ident ?? navaid.name ?? navaid.kind
                return (
                  <FeatureGroup key={navaid.id}>
                    {navaid.ident && mapZoom >= navaidLabelMinZoom ? (
                      <Marker
                        position={[navaid.lat, navaid.lon]}
                        icon={createMapLabelIcon('fp-navaid-label-marker', navaid.ident)}
                        pane="fp-navaid-pane"
                        interactive={false}
                        keyboard={false}
                        zIndexOffset={100}
                      />
                    ) : null}
                    <CircleMarker
                      center={[navaid.lat, navaid.lon]}
                      pane="fp-navaid-pane"
                      radius={palette.radius}
                      pathOptions={{
                        color: palette.color,
                        weight: 1.25,
                        fillColor: palette.fillColor,
                        fillOpacity: 0.92,
                      }}
                      eventHandlers={{
                        click: (event) => {
                          event.originalEvent.preventDefault()
                          event.originalEvent.stopPropagation()
                          addNavaidPointToEnd(navaid)
                        },
                        mouseout: closeLeafletTooltipOnMouseOut,
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -6]} opacity={0.95} className="fp-hover-tooltip fp-navaid-tooltip">
                        <div className="fp-airport-tooltip fp-navaid-tooltip__content">
                          <strong>{label}</strong>
                          <span>{navaid.kind === 'DMEV' ? 'VOR/DME' : navaid.kind}</span>
                          {navaid.frequency ? <span>{navaid.frequency}</span> : null}
                          {navaid.channel ? <span>Kanal {navaid.channel}</span> : null}
                          <span>{formatCoordinateDms(navaid.lat, 'lat')} {formatCoordinateDms(navaid.lon, 'lon')}</span>
                        </div>
                      </Tooltip>
                    </CircleMarker>
                  </FeatureGroup>
                )
              })
            : null}

          {visibleVisualPoints.map((point) => {
            const palette = getVisualPointPalette(point.kind)
            const label = getVisualPointDisplayLabel(point)
            return (
              <FeatureGroup key={point.id}>
                {mapZoom >= visualPointLabelMinZoom ? (
                  <Marker
                    position={[point.lat, point.lon]}
                    icon={createMapLabelIcon(`fp-visual-point-label-marker fp-visual-point-label-marker--${point.kind}`, label)}
                    pane="fp-visual-point-pane"
                    interactive={false}
                    keyboard={false}
                    zIndexOffset={105}
                  />
                ) : null}
                <CircleMarker
                  center={[point.lat, point.lon]}
                  pane="fp-visual-point-pane"
                  radius={palette.radius}
                  pathOptions={{
                    color: palette.color,
                    weight: 1.45,
                    fillColor: palette.fillColor,
                    fillOpacity: 0.95,
                  }}
                  eventHandlers={{
                    click: (event) => {
                      event.originalEvent.preventDefault()
                      event.originalEvent.stopPropagation()
                      addVisualPointToEnd(point)
                    },
                    mouseout: closeLeafletTooltipOnMouseOut,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -6]} opacity={0.95} className="fp-hover-tooltip fp-visual-point-tooltip">
                    <div className="fp-airport-tooltip fp-visual-point-tooltip__content">
                      <strong>{label}</strong>
                      <span>{getVisualPointKindLabel(point.kind)}{point.positionIndicator ? ` · ${point.positionIndicator}` : ''}</span>
                      {point.name && point.name !== label ? <span>{point.name}</span> : null}
                      {point.comment ? <span>{point.comment}</span> : null}
                      <span>{formatCoordinateDms(point.lat, 'lat')} {formatCoordinateDms(point.lon, 'lon')}</span>
                    </div>
                  </Tooltip>
                </CircleMarker>
              </FeatureGroup>
            )
          })}

          {visibleObstacles.map((obstacle) => {
            const palette = getObstaclePalette(obstacle)
            const obstacleType = getObstacleDisplayType(obstacle)
            return (
              <CircleMarker
                key={obstacle.id}
                center={[obstacle.lat, obstacle.lon]}
                pane={obstacleMapPane}
                radius={palette.radius}
                pathOptions={{
                  color: palette.color,
                  weight: 1.3,
                  fillColor: palette.fillColor,
                  fillOpacity: 0.82,
                }}
                eventHandlers={{ mouseout: closeLeafletTooltipOnMouseOut }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={0.95} className="fp-hover-tooltip fp-obstacle-tooltip">
                  <div className="fp-airport-tooltip fp-obstacle-tooltip__content">
                    <strong>{obstacle.name ?? obstacleType}</strong>
                    <span>{obstacleType}</span>
                    {formatObstacleHeight(obstacle.heightValue, obstacle.heightUnit) ? (
                      <span>Höjd {formatObstacleHeight(obstacle.heightValue, obstacle.heightUnit)}</span>
                    ) : null}
                    {formatObstacleHeight(obstacle.mslValue, obstacle.mslUnit) ? (
                      <span>MSL {formatObstacleHeight(obstacle.mslValue, obstacle.mslUnit)}</span>
                    ) : null}
                    {obstacle.lightingDescription ? <span>Ljus {obstacle.lightingDescription}</span> : null}
                    {obstacle.cycleId ? <span>LFV {obstacle.cycleId}</span> : null}
                  </div>
                </Tooltip>
              </CircleMarker>
            )
          })}

          {airspaceLabels.map((label) => (
            <Marker
              key={label.id}
              position={label.position}
              icon={createMapLabelIcon(
                `fp-airspace-map-label fp-airspace-map-label--${label.variant} ${isAirspaceLabelHighlighted(label) ? 'fp-airspace-map-label--is-highlighted' : ''}`,
                label.label,
              )}
              pane="fp-airspace-label-pane"
              interactive={false}
              keyboard={false}
              zIndexOffset={90}
            />
          ))}

          {showAirportMarkers ? swedishAirports.map((airport) => {
            const airportWeather = airport.icao ? airportWeatherByIcao[airport.icao] : null
            const flightRules = getAirportDisplayFlightRules(airportWeather, { showMetar, showTaf })
            const weatherLines = getAirportTooltipWeatherLines(airportWeather)
            const hasWeatherData = hasAirportWeatherData(airportWeather, { showMetar, showTaf })
            const iconSize = showAirportWeather && !hasWeatherData ? 'small' : 'default'
            const airportAdNotam = getAirportNotamLookup(airport.icao)
            const serviceHoursSchedule = airportAdNotam?.status === 'ready'
              ? buildAirportServiceHoursSchedule(
                  airportAdNotam.entry?.rawText ?? null,
                  plan.header.date,
                  plan.header.plannedStartTime,
                )
              : null

            return (
            <Marker
              key={airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`}
              position={[airport.lat, airport.lon]}
              icon={createAirportIcon(flightRules.category, iconSize)}
              pane="fp-airport-pane"
              keyboard={false}
              zIndexOffset={hasWeatherData ? 140 : 70}
              eventHandlers={{
                click: (event) => {
                  event.originalEvent.preventDefault()
                  event.originalEvent.stopPropagation()
                  if (isCoarsePointerInput()) {
                    event.target.closeTooltip()
                  }

                  if (routeEditingEnabled) {
                    addPointToEnd(airport.lat, airport.lon)
                  } else {
                    inspectAirport(airport)
                  }
                },
                mouseover: () => loadAirportNotam(airport),
                mouseout: closeLeafletTooltipOnMouseOut,
              }}
            >
              {airport.icao && mapZoom >= airportLabelMinZoom && showAirports ? (
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -12]}
                  opacity={1}
                  className="fp-airport-label"
                >
                  <span>{airport.icao}</span>
                </Tooltip>
              ) : null}
              <Tooltip direction="top" offset={[0, -6]} opacity={0.95} className="fp-hover-tooltip fp-airport-tooltip-popup">
                <div className="fp-airport-tooltip">
                  <strong>{airport.icao}</strong>
                  <span>{airport.name}</span>
                  {weatherLines.map((line) => (
                    <span className="fp-airport-tooltip__weather-line" key={line}>{line}</span>
                  ))}
                  {serviceHoursSchedule ? (
                    <>
                      <span>{serviceHoursSchedule.title}</span>
                      <AirportTowerHoursTable days={serviceHoursSchedule.days} compact />
                    </>
                  ) : null}
                  <span>{formatCoordinateDms(airport.lat, 'lat')} {formatCoordinateDms(airport.lon, 'lon')}</span>
                </div>
              </Tooltip>
            </Marker>
          )}) : null}

          {previewRouteLegs.map((leg, index) => (
            <FeatureGroup key={`segment-${index}`}>
              <Polyline
                positions={[
                  [leg.from.lat, leg.from.lon],
                  [leg.to.lat, leg.to.lon],
                ]}
                pathOptions={{
                  color: '#ff35c4',
                  weight: routeLineWeight,
                  className: `fp-route-segment fp-route-segment--${index}`,
                }}
                eventHandlers={{
                  mousedown: (event) => {
                    if (!routeEditingEnabled) {
                      return
                    }

                    event.originalEvent.preventDefault()
                    event.originalEvent.stopPropagation()
                    startSegmentInsertDrag(index, event.latlng.lat, event.latlng.lng)
                  },
                  mouseout: closeLeafletTooltipOnMouseOut,
                }}
              >
                <Tooltip sticky opacity={1} className="fp-hover-tooltip fp-segment-tooltip">
                  <div>
                    <strong>{getRoutePointLabel(leg.from)} → {getRoutePointLabel(leg.to)}</strong>
                    <span>TT {previewDerived.routeLegs[index]?.trueTrack ?? '—'}°</span>
                    <span>MH {previewDerived.routeLegs[index]?.magneticHeading ?? '—'}°</span>
                    <span>GS {previewDerived.routeLegs[index]?.groundSpeedKt ?? '—'} kt</span>
                    <span>Dist {previewDerived.routeLegs[index]?.distanceNm ?? '—'} nm</span>
                    <span>Tid {formatTimeFromMinutes(previewDerived.routeLegs[index]?.legTimeMinutes ?? 0)}</span>
                  </div>
                </Tooltip>
              </Polyline>
              {shouldShowDirectionArrow(leg) ? (
                <Marker
                  position={(() => {
                    const point = projectedMidpoint(mapInstance, leg.from, leg.to)
                    return [point.lat, point.lon] as [number, number]
                  })()}
                  icon={createChevronIcon(previewDerived.routeLegs[index]?.trueTrack ?? 0)}
                  interactive={false}
                  keyboard={false}
                  zIndexOffset={200}
                />
              ) : null}
              {printMode ? (
                <Marker
                  position={(() => {
                    const point = projectedOffsetRoutePoint(mapInstance, leg.from, leg.to, 0.28, -22)
                    return [point.lat, point.lon] as [number, number]
                  })()}
                  icon={createPrintRouteLegInfoIcon({
                    magneticHeading: previewDerived.routeLegs[index]?.magneticHeading ?? '-',
                    magneticTrack: previewDerived.routeLegs[index]
                      ? Math.round(normalizeDegrees(previewDerived.routeLegs[index].trueTrack - leg.variation))
                      : '-',
                    time: formatTimeFromMinutes(previewDerived.routeLegs[index]?.legTimeMinutes ?? 0),
                  })}
                  interactive={false}
                  keyboard={false}
                  zIndexOffset={260}
                />
              ) : null}
            </FeatureGroup>
          ))}

          {displayWaypoints.map((point, index) => (
            <Marker
              key={`waypoint-${waypointMarkerLayerVersion}-${index}`}
              position={[point.lat, point.lon]}
              icon={waypointIcon}
              draggable={routeEditingEnabled && displayWaypoints.length > 1}
              eventHandlers={{
                dragstart: () => {
                  if (!routeEditingEnabled) {
                    return
                  }

                  suppressNextMapClick.current = true
                  setDragPreviewWaypoints(waypoints)
                },
                drag: (event) => {
                  if (!routeEditingEnabled) {
                    return
                  }

                  const marker = event.target as L.Marker
                  const latLng = marker.getLatLng()
                  previewMoveWaypoint(index, latLng.lat, latLng.lng)
                },
                dragend: (event) => {
                  if (!routeEditingEnabled) {
                    return
                  }

                  const marker = event.target as L.Marker
                  const latLng = marker.getLatLng()
                  updateWaypoint(index, latLng.lat, latLng.lng)
                },
                mouseout: closeLeafletTooltipOnMouseOut,
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1} className="fp-hover-tooltip fp-waypoint-tooltip">
                <div>
                  <strong>{getRoutePointLabel(point)}</strong>
                  <span>{formatCoordinateDms(point.lat, 'lat')} {formatCoordinateDms(point.lon, 'lon')}</span>
                </div>
              </Tooltip>
              <Popup className="fp-waypoint-popup" autoPan closeButton>
                <div
                  className="fp-waypoint-popup__content"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <strong>{getRoutePointLabel(point)}</strong>
                  <span>{formatCoordinateDms(point.lat, 'lat')} {formatCoordinateDms(point.lon, 'lon')}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      removeWaypoint(index)
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    disabled={!routeEditingEnabled || waypoints.length <= 2}
                  >
                    Ta bort waypoint
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        )}

      </div>
    </section>
  )
}
