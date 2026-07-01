import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import 'mapbox-gl/dist/mapbox-gl.css'

import { getSwedishAirportMapLabel, getSwedishVisualPointDisplayLabel, type SwedishAirspace, type SwedishAirport, type SwedishNavaid, type SwedishVisualPoint } from './aviationData'
import type { NotamMapOverlayFeature } from './notamRoute'
import { fetchSwedishObstacles, getObstacleDisplayType, type SwedishObstacle } from './obstacles'
import type { RouteLegAloftWind } from './openMeteoAloft'
import type { FlightPlanDerived, FlightPlanInput } from './types'
import type { RouteWeatherOverlay } from './weatherSigmet'
import {
  getAeronauticalAirspaceStyle,
  getMapboxAirspaceColorExpression,
  getMapboxAirspaceDashArrayExpression,
  getMapboxAirspaceFillColorExpression,
} from './aeronauticalMapSymbols'

type GeoJsonFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: Record<string, unknown>
}

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

type RouteProfilePoint = {
  lat: number
  lon: number
  distanceNm: number
  altitudeFt: number
}

type RouteGateFrame = {
  id: string
  lat: number
  lon: number
  gateBearingDeg: number
  baseMeters: number
  heightMeters: number
}

type RouteWaypoint3DObject = {
  id: string
  lat: number
  lon: number
  altitudeMeters: number
}

type RouteDirection3DObject = {
  id: string
  lat: number
  lon: number
  altitudeMeters: number
  bearingDeg: number
}

type AloftWind3DObject = {
  id: string
  lat: number
  lon: number
  altitudeMeters: number
  directionDeg: number
  speedKt: number
}

type Obstacle3DObject = {
  id: string
  lat: number
  lon: number
  heightMeters: number
  heightFt: number | null
  color: string
  category: SwedishObstacle['category']
  lighted: boolean
  temporary?: boolean
}

type HoldingPattern3DObject = {
  id: string
  lat: number
  lon: number
  label: string
}

type TerrainStatus = 'checking' | 'ready' | 'degraded' | 'error'

type TerrainDiagnostic = {
  status: TerrainStatus
  message: string
  details: string | null
}

export type FlightplanMapbox3DStyle = 'ortho' | 'topo' | 'standard' | 'light'
export type FlightplanMapboxAirportFlightCategory = 'VMC' | 'MVMC' | 'IMC' | 'UNKNOWN'

type MapboxCamera = {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}

type FlightplanMapboxInitialViewport = {
  center: [number, number]
  zoom: number
}

type FlightplanMapboxView = {
  bounds: {
    south: number
    west: number
    north: number
    east: number
  }
  zoom: number
}

type FlightplanMapboxObstacleView = FlightplanMapboxView & {
  key: string
}

const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim() ?? ''
const mapboxCameraStorageKey = 'flightplan-mapbox-3d-camera'
const terrainSourceId = 'mapbox-dem'
const routeSourceId = 'flightplan-3d-route'
const routeLayerId = 'flightplan-3d-route-line'
const routeCasingLayerId = 'flightplan-3d-route-casing'
const routeGateFrameLayerId = 'flightplan-3d-route-gate-frame'
const routeWaypointSourceId = 'flightplan-3d-route-waypoints'
const airspaceSourceId = 'flightplan-3d-airspaces'
const airspaceLayerId = 'flightplan-3d-airspaces'
const airspaceHitLayerId = 'flightplan-3d-airspaces-hit'
const airspaceOutlineLayerId = 'flightplan-3d-airspaces-outline'
const airspaceBaseOutlineLayerId = 'flightplan-3d-airspaces-base-outline'
const airspaceHighlightLayerId = 'flightplan-3d-airspaces-highlight'
const airspaceBaseHighlightLayerId = 'flightplan-3d-airspaces-base-highlight'
const notamVolumeSourceId = 'flightplan-3d-notam-volumes'
const notamVolumeLayerId = 'flightplan-3d-notam-volumes'
const notamVolumeOutlineLayerId = 'flightplan-3d-notam-volumes-outline'
const notamVolumeHighlightLayerId = 'flightplan-3d-notam-volumes-highlight'
const notamLineSourceId = 'flightplan-3d-notam-lines'
const notamLineLayerId = 'flightplan-3d-notam-lines'
const notamLineHighlightLayerId = 'flightplan-3d-notam-lines-highlight'
const notamPointSourceId = 'flightplan-3d-notam-points'
const notamPointLayerId = 'flightplan-3d-notam-points'
const notamPointHighlightLayerId = 'flightplan-3d-notam-points-highlight'
const notamObstacleSymbolSourceId = 'flightplan-3d-notam-obstacle-symbols'
const notamObstacleSymbolLayerId = 'flightplan-3d-notam-obstacle-symbols'
const notamObstacleLightOutSymbolLayerId = 'flightplan-3d-notam-obstacle-light-out-symbols'
const notamObstacleVolumeRenderLayerId = 'flightplan-3d-notam-obstacle-volumes-render'
const weatherAreaSourceId = 'flightplan-3d-weather-areas'
const weatherAreaHaloLayerId = 'flightplan-3d-weather-areas-halo'
const weatherAreaSoftEdgeLayerId = 'flightplan-3d-weather-areas-soft-edge'
const weatherAreaLayerId = 'flightplan-3d-weather-areas'
const weatherLineSourceId = 'flightplan-3d-weather-lines'
const weatherLineLayerId = 'flightplan-3d-weather-lines'
const mapPointSourceId = 'flightplan-3d-map-points'
const mapPointNavaidLayerId = 'flightplan-3d-map-point-navaids'
const mapPointAirportLayerId = 'flightplan-3d-map-point-airports'
const mapPointEntryExitLayerId = 'flightplan-3d-map-point-entry-exit'
const airportWeatherIconLayerId = 'flightplan-3d-airport-weather-icons'
const airportWeatherLabelLayerId = 'flightplan-3d-airport-weather-labels'
const mapPointLabelLayerId = 'flightplan-3d-map-point-labels'
const holdingPatternLayerId = 'flightplan-3d-holding-patterns'
const obstacleVolumeSourceId = 'flightplan-3d-obstacle-volumes'
const obstacleVolumeLayerId = 'flightplan-3d-obstacle-volumes'
const obstacleVolumeOutlineLayerId = 'flightplan-3d-obstacle-volumes-outline'
const obstacleVolumeRenderLayerId = 'flightplan-3d-obstacle-volumes-render'
const obstacleSymbolSourceId = 'flightplan-3d-obstacle-symbols'
const obstacleSymbolLayerId = 'flightplan-3d-obstacle-symbols'
const obstacleVolumeMinZoom = 8
const obstacleVolume3DMinZoom = 10.0
const emptyObstacles: SwedishObstacle[] = []
const aloftWindSourceId = 'flightplan-3d-aloft-winds'
const aloftWindLayerId = 'flightplan-3d-aloft-winds'
const tocTodSourceId = 'flightplan-3d-toc-tod'
const tocTodLayerId = 'flightplan-3d-toc-tod'
const buildingsLayerId = '3d-buildings'

const conservativeGaClimbRateFpm = 400
const conservativeGaDescentRateFpm = 400
const conservativeGaClimbSpeedKt = 85
const conservativeGaDescentSpeedKt = 90
const fallbackCruiseAltitudeFt = 2500
const fallbackDepartureElevationFt = 100
const fallbackArrivalElevationFt = 100
const arrivalTargetHeightFt = 1000
const terrainExaggeration = 1
const swedenOverviewCamera: MapboxCamera = {
  center: [16.8, 64.9],
  zoom: 4.6,
  pitch: 0,
  bearing: 0,
}
const feetToMeters = 0.3048
const metersPerNm = 1852
const airspaceFillOpacity = 0.18
const notamVolumeFillOpacity = 0.22
const routeAccentColor = '#ff35c4'
const aeronauticalSymbolBlue = '#005da8'
const routeGateMinZoom = 10.4
const airspaceOutlineOpacity = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  0.72,
  routeGateMinZoom - 0.1,
  0.72,
  routeGateMinZoom,
  0.16,
  14,
  0.1,
] satisfies mapboxgl.ExpressionSpecification
const airspaceUpperOutlineOpacity = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  0.95,
  routeGateMinZoom - 0.1,
  0.95,
  routeGateMinZoom,
  0.2,
  14,
  0.12,
] satisfies mapboxgl.ExpressionSpecification
const routeVisualClearanceMeters = 70
const routeGateHalfWidthNm = 0.11
const routeGateHalfHeightMeters = 140
const routeGateRibHalfSizeMeters = 3
const routeWaypointRadiusMeters = 58
const routeDirectionConeRadiusMeters = 44
const routeDirectionConeLengthMeters = 135
const aloftWindArrowLengthMeters = 155
const aloftWindArrowRadiusMeters = 14
const aloftWindArrowHeadRadiusMeters = 42
const aloftWindArrowHeadLengthMeters = 78
const reportingPointColor = '#732184'
const reportingPointSymbolMinZoom = 8.5
const reportingPointLabelMinZoom = 9
const mapPointSymbolMinZoom = 6
const airportSymbolMinZoom = 5.5
const mapPointIconIds = {
  airportSmall: 'flightplan-3d-airport-small',
  airportCivil: 'flightplan-3d-airport-civil',
  airportMilitary: 'flightplan-3d-airport-military',
  navaidDme: 'flightplan-3d-navaid-dme',
  navaidNdb: 'flightplan-3d-navaid-ndb',
  navaidVor: 'flightplan-3d-navaid-vor',
  navaidDmev: 'flightplan-3d-navaid-dmev',
  weatherVmc: 'flightplan-3d-weather-vmc',
  weatherMvmc: 'flightplan-3d-weather-mvmc',
  weatherImc: 'flightplan-3d-weather-imc',
  weatherUnknown: 'flightplan-3d-weather-unknown',
} as const
const obstacleIconIdPrefix = 'flightplan-3d-obstacle-symbol'
const obstacleLightOutIconId = 'flightplan-3d-obstacle-light-out-symbol'
const holdingPatternMinZoom = 9
const holdingPatternAltitudeFt = 1000
const holdingPatternRadiusMeters = 475
const holdingPatternTubeMeters = 12
const holdingPatternLabelBaseRotationRad = Math.PI
const notamVolumeBaseFt = 0
const notamVolumeDefaultUpperFt = 5000
const mapboxStyleUrls: Record<FlightplanMapbox3DStyle, string> = {
  ortho: 'mapbox://styles/mapbox/standard-satellite',
  topo: 'mapbox://styles/mapbox/outdoors-v12',
  standard: 'mapbox://styles/mapbox/standard',
  light: 'mapbox://styles/mapbox/light-v11',
}

function emptyGeoJsonFeatureCollection(): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function getInitialTerrainDiagnostic(): TerrainDiagnostic {
  if (typeof document === 'undefined') {
    return {
      status: 'checking',
      message: 'Kontrollerar 3D-terräng',
      details: null,
    }
  }

  const canvas = document.createElement('canvas')
  const hasWebGl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))

  return hasWebGl
    ? {
        status: 'checking',
        message: 'Kontrollerar 3D-terräng',
        details: null,
      }
    : {
        status: 'error',
        message: 'WebGL saknas',
        details: '3D-terräng kräver WebGL. Kontrollera grafikacceleration i webbläsaren.',
      }
}

function getMapboxErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'object' && error != null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }

  return String(error)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatGenericPopup(properties: mapboxgl.GeoJSONFeature['properties']) {
  const title = String(properties?.title ?? properties?.label ?? 'Objekt')
  const body = String(properties?.body ?? '')

  return `
    <div class="fp-mapbox3d-popup">
      <strong>${escapeHtml(title)}</strong>
      ${body ? `<span>${escapeHtml(body)}</span>` : ''}
    </div>
  `
}

function idMatchFilter(ids: string[]) {
  return ['in', ['to-string', ['get', 'id']], ['literal', ids]] as mapboxgl.FilterSpecification
}

function getRenderedFeatureIds(features: mapboxgl.MapboxGeoJSONFeature[]) {
  return Array.from(new Set(
    features
      .map((feature) => String(feature.properties?.id ?? ''))
      .filter(Boolean),
  ))
}

function setLayerIdFilter(map: mapboxgl.Map, layerId: string, ids: string[]) {
  if (!map.getLayer(layerId)) {
    return
  }

  map.setFilter(layerId, idMatchFilter(ids))
}

function parseAltitudeFt(value: string | null | undefined, fallback: number | null = null) {
  if (!value) {
    return fallback
  }

  const normalized = value
    .replace(/\u00a0/g, ' ')
    .replace(/,/g, '')
    .trim()
    .toUpperCase()

  if (/\b(?:GND|SFC|GROUND)\b/.test(normalized)) {
    return 0
  }

  const flightLevel = normalized.match(/\bFL\s*(\d{2,3})\b/)
  if (flightLevel) {
    return Number(flightLevel[1]) * 100
  }

  const feet = normalized.match(/(\d+(?:\.\d+)?)\s*(?:FT|FEET|'|AMSL|MSL|AGL)?/)
  if (feet) {
    return Number(feet[1])
  }

  return fallback
}

function getLegAltitudeFt(leg: FlightPlanInput['routeLegs'][number]) {
  return parseAltitudeFt(leg.altitude, fallbackCruiseAltitudeFt) ?? fallbackCruiseAltitudeFt
}

function interpolateRoutePosition(
  plan: FlightPlanInput,
  derived: FlightPlanDerived,
  distanceNm: number,
) {
  if (plan.routeLegs.length === 0) {
    return null
  }

  const boundedDistance = Math.max(0, Math.min(distanceNm, derived.totals.distanceNm))
  let previousAccumulatedDistanceNm = 0

  for (let index = 0; index < plan.routeLegs.length; index += 1) {
    const leg = plan.routeLegs[index]
    const derivedLeg = derived.routeLegs[index]
    if (!leg || !derivedLeg) {
      continue
    }

    const legDistanceNm = derivedLeg.distanceNm
    const legEndDistanceNm = previousAccumulatedDistanceNm + legDistanceNm
    if (boundedDistance <= legEndDistanceNm || index === plan.routeLegs.length - 1) {
      const fraction = legDistanceNm > 0 ? (boundedDistance - previousAccumulatedDistanceNm) / legDistanceNm : 0
      return {
        lat: leg.from.lat + (leg.to.lat - leg.from.lat) * fraction,
        lon: leg.from.lon + (leg.to.lon - leg.from.lon) * fraction,
      }
    }

    previousAccumulatedDistanceNm = legEndDistanceNm
  }

  const finalLeg = plan.routeLegs[plan.routeLegs.length - 1]
  return finalLeg ? { lat: finalLeg.to.lat, lon: finalLeg.to.lon } : null
}

function buildRouteProfile(plan: FlightPlanInput, derived: FlightPlanDerived) {
  const totalDistanceNm = derived.totals.distanceNm
  if (plan.routeLegs.length === 0 || totalDistanceNm <= 0) {
    return {
      route: null,
      gates: [] satisfies RouteGateFrame[],
      markers: {
        type: 'FeatureCollection',
        features: [],
      } satisfies GeoJsonFeatureCollection,
      profilePoints: [] satisfies RouteProfilePoint[],
      summary: null,
    }
  }

  const cruiseAltitudeFt = Math.max(
    ...plan.routeLegs.map(getLegAltitudeFt),
    fallbackCruiseAltitudeFt,
  )
  const departureAltitudeFt = fallbackDepartureElevationFt
  const arrivalAltitudeFt = fallbackArrivalElevationFt + arrivalTargetHeightFt
  const climbDistanceNm = Math.max(0, ((cruiseAltitudeFt - departureAltitudeFt) / conservativeGaClimbRateFpm) * conservativeGaClimbSpeedKt / 60)
  const descentDistanceNm = Math.max(0, ((cruiseAltitudeFt - arrivalAltitudeFt) / conservativeGaDescentRateFpm) * conservativeGaDescentSpeedKt / 60)
  const topOfClimbDistanceNm = Math.min(climbDistanceNm, totalDistanceNm)
  const topOfDescentDistanceNm = Math.max(0, totalDistanceNm - descentDistanceNm)
  const sampleCount = Math.max(24, Math.min(180, Math.ceil(totalDistanceNm * 2)))
  const waypointDistances = plan.routeLegs.reduce<number[]>((distances, _leg, index) => {
    const previousDistanceNm = distances[index] ?? 0
    const legDistanceNm = derived.routeLegs[index]?.distanceNm ?? 0
    distances.push(previousDistanceNm + legDistanceNm)
    return distances
  }, [0])
  const sampleDistances = [
    ...Array.from({ length: sampleCount + 1 }, (_, index) => (totalDistanceNm * index) / sampleCount),
    ...waypointDistances,
    topOfClimbDistanceNm,
    topOfDescentDistanceNm,
  ]
    .filter((distanceNm) => Number.isFinite(distanceNm))
    .map((distanceNm) => Math.max(0, Math.min(totalDistanceNm, distanceNm)))
    .sort((a, b) => a - b)
    .filter((distanceNm, index, distances) => index === 0 || Math.abs(distanceNm - distances[index - 1]) > 0.0001)

  const profilePoints: RouteProfilePoint[] = sampleDistances.map((distanceNm) => {
    const position = interpolateRoutePosition(plan, derived, distanceNm)
    let altitudeFt = cruiseAltitudeFt

    if (distanceNm < topOfClimbDistanceNm && topOfClimbDistanceNm > 0) {
      altitudeFt = departureAltitudeFt + ((cruiseAltitudeFt - departureAltitudeFt) * distanceNm) / topOfClimbDistanceNm
    } else if (distanceNm > topOfDescentDistanceNm && descentDistanceNm > 0) {
      altitudeFt = cruiseAltitudeFt - ((cruiseAltitudeFt - arrivalAltitudeFt) * (distanceNm - topOfDescentDistanceNm)) / descentDistanceNm
    }

    return {
      lat: position?.lat ?? plan.routeLegs[0].from.lat,
      lon: position?.lon ?? plan.routeLegs[0].from.lon,
      distanceNm,
      altitudeFt: Math.max(0, altitudeFt),
    }
  })

  const markers = [
    { label: 'TOC', distanceNm: topOfClimbDistanceNm },
    { label: 'TOD', distanceNm: topOfDescentDistanceNm },
  ].map(({ label, distanceNm }) => {
    const position = interpolateRoutePosition(plan, derived, distanceNm)
    const altitudeFt = profilePoints.reduce((closest, point) => (
      Math.abs(point.distanceNm - distanceNm) < Math.abs(closest.distanceNm - distanceNm) ? point : closest
    ), profilePoints[0]).altitudeFt

    return {
      type: 'Feature',
      properties: {
        label,
        altitudeFt: Math.round(altitudeFt),
        distanceNm: Number(distanceNm.toFixed(1)),
      },
      geometry: {
        type: 'Point',
        coordinates: [position?.lon ?? profilePoints[0].lon, position?.lat ?? profilePoints[0].lat],
      },
    } satisfies GeoJsonFeature
  })
  const gateIntervalNm = Math.max(0.6, Math.min(2.5, totalDistanceNm / 90))
  const gateDistances = Array.from(
    { length: Math.max(0, Math.floor(totalDistanceNm / gateIntervalNm) - 1) },
    (_, index) => (index + 1) * gateIntervalNm,
  )
  const gateFrames: RouteGateFrame[] = []

  for (const [index, distanceNm] of gateDistances.entries()) {
    const pointIndex = profilePoints.findIndex((point) => point.distanceNm >= distanceNm)
    const nextPoint = profilePoints[Math.max(1, pointIndex === -1 ? profilePoints.length - 1 : pointIndex)]
    const previousPoint = profilePoints[Math.max(0, profilePoints.indexOf(nextPoint) - 1)]
    const position = interpolateRoutePosition(plan, derived, distanceNm) ?? nextPoint
    const bearingDeg = initialBearingDegrees(previousPoint.lat, previousPoint.lon, nextPoint.lat, nextPoint.lon)
    const gateBearingDeg = bearingDeg + 90
    const altitudeFt = profilePoints.reduce((closest, point) => (
      Math.abs(point.distanceNm - distanceNm) < Math.abs(closest.distanceNm - distanceNm) ? point : closest
    ), profilePoints[0]).altitudeFt
    const centerElevationMeters = altitudeFt * feetToMeters + routeVisualClearanceMeters
    const baseMeters = Math.max(0, centerElevationMeters - routeGateHalfHeightMeters)
    const heightMeters = centerElevationMeters + routeGateHalfHeightMeters

    gateFrames.push({
      id: `route-gate-${index}`,
      lat: position.lat,
      lon: position.lon,
      gateBearingDeg,
      baseMeters,
      heightMeters,
    })
  }

  return {
    route: {
      type: 'Feature',
      properties: {
        elevation: profilePoints.map((point) => point.altitudeFt * feetToMeters),
      },
      geometry: {
        type: 'LineString',
        coordinates: profilePoints.map((point) => [point.lon, point.lat]),
      },
    } satisfies GeoJsonFeature,
    gates: gateFrames,
    markers: {
      type: 'FeatureCollection',
      features: markers,
    } satisfies GeoJsonFeatureCollection,
    profilePoints,
    summary: {
      cruiseAltitudeFt,
      topOfClimbDistanceNm,
      topOfDescentDistanceNm,
    },
  }
}

function buildRouteWaypointGeoJson(plan: FlightPlanInput) {
  if (plan.routeLegs.length === 0) {
    return emptyGeoJsonFeatureCollection()
  }

  const waypoints = [
    plan.routeLegs[0].from,
    ...plan.routeLegs.map((leg) => leg.to),
  ].filter((point, index, points) => (
    index === 0 ||
    point.lat !== points[index - 1].lat ||
    point.lon !== points[index - 1].lon ||
    point.name !== points[index - 1].name
  ))

  return {
    type: 'FeatureCollection',
    features: waypoints.map((point, index) => ({
      type: 'Feature',
      properties: {
        id: `route-waypoint-${index}`,
        label: point.name?.trim() || `WP${index + 1}`,
        index: index + 1,
      },
      geometry: {
        type: 'Point',
        coordinates: [point.lon, point.lat],
      },
    })),
  } satisfies GeoJsonFeatureCollection
}

function interpolateProfileAltitudeMeters(profilePoints: RouteProfilePoint[], distanceNm: number) {
  if (profilePoints.length === 0) {
    return routeVisualClearanceMeters
  }

  if (distanceNm <= profilePoints[0].distanceNm) {
    return profilePoints[0].altitudeFt * feetToMeters + routeVisualClearanceMeters
  }

  for (let index = 1; index < profilePoints.length; index += 1) {
    const previous = profilePoints[index - 1]
    const next = profilePoints[index]
    if (distanceNm <= next.distanceNm) {
      const span = Math.max(0.000001, next.distanceNm - previous.distanceNm)
      const fraction = Math.max(0, Math.min(1, (distanceNm - previous.distanceNm) / span))
      return (previous.altitudeFt + (next.altitudeFt - previous.altitudeFt) * fraction) * feetToMeters + routeVisualClearanceMeters
    }
  }

  return profilePoints[profilePoints.length - 1].altitudeFt * feetToMeters + routeVisualClearanceMeters
}

function buildRoute3DObjects(
  plan: FlightPlanInput,
  derived: FlightPlanDerived,
  profilePoints: RouteProfilePoint[],
) {
  const waypointObjects: RouteWaypoint3DObject[] = []
  const directionObjects: RouteDirection3DObject[] = []
  let accumulatedDistanceNm = 0

  if (plan.routeLegs.length === 0) {
    return { waypoints: waypointObjects, directions: directionObjects }
  }

  waypointObjects.push({
    id: 'route-waypoint-0',
    lat: plan.routeLegs[0].from.lat,
    lon: plan.routeLegs[0].from.lon,
    altitudeMeters: interpolateProfileAltitudeMeters(profilePoints, 0),
  })

  for (let index = 0; index < plan.routeLegs.length; index += 1) {
    const leg = plan.routeLegs[index]
    const derivedLeg = derived.routeLegs[index]
    const legDistanceNm = derivedLeg?.distanceNm ?? 0
    const waypointDistanceNm = accumulatedDistanceNm + legDistanceNm

    if (
      leg.to.lat !== leg.from.lat ||
      leg.to.lon !== leg.from.lon ||
      leg.to.name !== leg.from.name ||
      index > 0
    ) {
      waypointObjects.push({
        id: `route-waypoint-${index + 1}`,
        lat: leg.to.lat,
        lon: leg.to.lon,
        altitudeMeters: interpolateProfileAltitudeMeters(profilePoints, waypointDistanceNm),
      })
    }

    if (legDistanceNm > 0.05) {
      const midpointDistanceNm = accumulatedDistanceNm + legDistanceNm / 2
      const midpoint = interpolateRoutePosition(plan, derived, midpointDistanceNm)
      if (midpoint) {
        directionObjects.push({
          id: `route-direction-${index}`,
          lat: midpoint.lat,
          lon: midpoint.lon,
          altitudeMeters: interpolateProfileAltitudeMeters(profilePoints, midpointDistanceNm),
          bearingDeg: derivedLeg?.trueTrack ?? initialBearingDegrees(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon),
        })
      }
    }

    accumulatedDistanceNm = waypointDistanceNm
  }

  return { waypoints: waypointObjects, directions: directionObjects }
}

function buildAloftWind3DObjects(aloftWinds: RouteLegAloftWind[]) {
  return aloftWinds.map((wind, index) => ({
    id: `wind-${index}`,
    lat: wind.midpoint.lat,
    lon: wind.midpoint.lon,
    altitudeMeters: Math.max(routeVisualClearanceMeters, wind.altitudeMetersMsl + routeVisualClearanceMeters),
    directionDeg: wind.direction,
    speedKt: wind.speedKt,
  })) satisfies AloftWind3DObject[]
}

function buildAirspaceGeoJson(airspaces: SwedishAirspace[]) {
  const features: GeoJsonFeature[] = []

  for (const airspace of airspaces) {
    const lowerFt = parseAltitudeFt(airspace.lower, 0) ?? 0
    const upperFt = parseAltitudeFt(airspace.upper, null)
    if (upperFt == null || upperFt <= lowerFt) {
      continue
    }
    const style = getAeronauticalAirspaceStyle(airspace.kind)

    features.push({
      type: 'Feature',
      properties: {
        id: airspace.id,
        name: airspace.name ?? airspace.positionIndicator ?? airspace.id,
        kind: airspace.kind,
        lower: airspace.lower,
        upper: airspace.upper,
        baseMeters: Math.max(0, lowerFt * feetToMeters),
        heightMeters: Math.max((lowerFt + 200) * feetToMeters, upperFt * feetToMeters),
        color: style.strokeColor,
        fillColor: style.fillColor,
      },
      geometry: airspace.geometry,
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  } satisfies GeoJsonFeatureCollection
}

function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceNm: number): [number, number] {
  const angularDistance = distanceNm / 3440.065
  const bearing = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  )

  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]
}

function initialBearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const lat1 = (fromLat * Math.PI) / 180
  const lat2 = (toLat * Math.PI) / 180
  const dLon = ((toLon - fromLon) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI

  return bearing < 0 ? bearing + 360 : bearing
}

function circlePolygonCoordinates(lat: number, lon: number, radiusNm: number) {
  const points = Array.from({ length: 64 }, (_, index) => destinationPoint(lat, lon, (index / 64) * 360, radiusNm))
  points.push(points[0])
  return [points]
}

function obstacleUnitToMeters(value: number | null, unit: string | null) {
  if (value == null || !Number.isFinite(value)) {
    return null
  }

  const normalizedUnit = unit?.trim().toUpperCase() ?? 'M'
  if (normalizedUnit === 'FT' || normalizedUnit === 'FEET') {
    return value * feetToMeters
  }

  return value
}

function obstacleHeightFt(obstacle: SwedishObstacle) {
  if (obstacle.heightValue == null || !Number.isFinite(obstacle.heightValue)) {
    return null
  }

  const unit = obstacle.heightUnit?.trim().toUpperCase() ?? 'M'
  return unit === 'FT' || unit === 'FEET' ? obstacle.heightValue : obstacle.heightValue / feetToMeters
}

function getObstacle3DColorFromHeightFt(heightFt: number | null) {
  return heightFt != null && heightFt < 130 ? '#732184' : '#1f5db8'
}

function getObstacle3DColor(obstacle: SwedishObstacle) {
  return getObstacle3DColorFromHeightFt(obstacleHeightFt(obstacle))
}

function isObstacleLighted(obstacle: SwedishObstacle) {
  const lighting = obstacle.lightingDescription?.trim().toLowerCase() ?? ''
  if (!lighting) {
    return false
  }

  return !/\b(?:unlighted|none|no|nej|obelyst)\b/.test(lighting)
}

function obstacleFootprintCoordinates(lat: number, lon: number, radiusMeters: number) {
  const radiusNm = radiusMeters / metersPerNm
  const points = Array.from({ length: 12 }, (_, index) => destinationPoint(lat, lon, (index / 12) * 360, radiusNm))
  points.push(points[0])
  return [points]
}

function getObstacle3DHitRadiusMeters(obstacle: SwedishObstacle) {
  return obstacle.category === 'wind_turbine' ? 70 : 52
}

function inferNotamObstacleCategory(feature: NotamMapOverlayFeature): SwedishObstacle['category'] {
  const text = `${feature.title} ${feature.rawText}`
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  if (/\bwind\s*turbine\b|\bwindturbine\b|\bvindkraft/.test(text)) return 'wind_turbine'
  if (/\bcrane\b|\bkran\b/.test(text)) return 'crane'
  if (/\bmast\b|\btelemast\b|\bantenna\b/.test(text)) return 'mast'
  if (/\btower\b|\btorn\b/.test(text)) return 'tower'
  if (/\bchimney\b|\bskorsten\b|\bstack\b/.test(text)) return 'chimney'
  if (/\bpower\s*line\b|\bpylon\b|\bkraftledning\b/.test(text)) return 'powerline_or_pylon'
  if (/\bbuilding\b|\bbyggnad\b/.test(text)) return 'building'

  return 'other'
}

function extractNotamObstacleHeight(rawText: string): { value: number | null; unit: string | null } {
  const normalized = rawText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
  const match = normalized.match(/\b(?:HEIGHT|HGT|HÖJD|HOJD)\s*(?:OF\s+)?(?:OBST(?:ACLE)?\s*)?(?:IS\s*)?(\d{2,5})\s*(FT|FEET|M|METER|METERS|METRE|METRES)\b/i)
    ?? normalized.match(/\b(\d{2,5})\s*(FT|FEET|M|METER|METERS|METRE|METRES)\s*(?:AGL|GND)\b/i)

  if (!match) {
    return { value: null, unit: null }
  }

  const value = Number(match[1])
  if (!Number.isFinite(value)) {
    return { value: null, unit: null }
  }

  const unit = match[2].toUpperCase().startsWith('FT') || match[2].toUpperCase() === 'FEET' ? 'FT' : 'M'
  return { value, unit }
}

function notamObstacleHeightFt(rawText: string) {
  const height = extractNotamObstacleHeight(rawText)
  if (height.value == null) {
    return null
  }

  const unit = height.unit?.trim().toUpperCase() ?? 'M'
  return unit === 'FT' || unit === 'FEET' ? height.value : height.value / feetToMeters
}

type RouteGateCustomLayer = mapboxgl.CustomLayerInterface & {
  setGates: (gates: RouteGateFrame[]) => void
}

type RouteObjectsCustomLayer = mapboxgl.CustomLayerInterface & {
  setRouteObjects: (waypoints: RouteWaypoint3DObject[], directions: RouteDirection3DObject[], winds: AloftWind3DObject[]) => void
}

type ObstacleVolumeCustomLayer = mapboxgl.CustomLayerInterface & {
  setObstacles: (obstacles: Obstacle3DObject[]) => void
}

type HoldingPatternCustomLayer = mapboxgl.CustomLayerInterface & {
  setHoldings: (holdings: HoldingPattern3DObject[]) => void
}

function createRouteGateFrameLayer(initialGates: RouteGateFrame[]): RouteGateCustomLayer {
  let map: mapboxgl.Map | null = null
  let camera: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let gates = initialGates
  const gateMaterial = new THREE.MeshBasicMaterial({
    color: routeAccentColor,
    // Mapbox terrain and draped airspace lines can otherwise mask the route gates.
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  function disposeScene() {
    if (!scene) {
      return
    }

    for (const child of [...scene.children]) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
      }
      scene.remove(child)
    }
  }

  function rebuildScene() {
    if (!scene) {
      return
    }

    disposeScene()

    for (const gate of gates) {
      addGateFrameMeshes(scene, gate, gateMaterial)
    }
  }

  return {
    id: routeGateFrameLayerId,
    type: 'custom',
    slot: 'top',
    renderingMode: '3d',
    onAdd(nextMap, gl) {
      map = nextMap
      camera = new THREE.Camera()
      scene = new THREE.Scene()
      renderer = new THREE.WebGLRenderer({
        canvas: nextMap.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      rebuildScene()
    },
    onRemove() {
      disposeScene()
      gateMaterial.dispose()
      renderer?.dispose()
      map = null
      camera = null
      renderer = null
      scene = null
    },
    render(_gl, matrix) {
      if (!map || !camera || !renderer || !scene || map.getZoom() < routeGateMinZoom) {
        return
      }

      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix)
      renderer.resetState()
      renderer.clearDepth()
      renderer.render(scene, camera)
    },
    setGates(nextGates) {
      gates = nextGates
      rebuildScene()
      map?.triggerRepaint()
    },
  }
}

function createRouteObjectsLayer(
  initialWaypoints: RouteWaypoint3DObject[],
  initialDirections: RouteDirection3DObject[],
  initialWinds: AloftWind3DObject[],
): RouteObjectsCustomLayer {
  let map: mapboxgl.Map | null = null
  let camera: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let waypoints = initialWaypoints
  let directions = initialDirections
  let winds = initialWinds
  const waypointMaterial = new THREE.MeshBasicMaterial({
    color: routeAccentColor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const waypointHaloMaterial = new THREE.MeshBasicMaterial({
    color: '#111827',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const routeDirectionMaterial = new THREE.MeshBasicMaterial({
    color: '#111827',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const windMaterial = new THREE.MeshBasicMaterial({
    color: '#0f766e',
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  function disposeScene() {
    if (!scene) {
      return
    }

    for (const child of [...scene.children]) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
        child.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose()
          }
        })
      }

      scene.remove(child)
    }
  }

  function rebuildScene() {
    if (!scene) {
      return
    }

    disposeScene()

    for (const waypoint of waypoints) {
      addRouteWaypointSphere(scene, waypoint, waypointMaterial, waypointHaloMaterial)
    }

    for (const direction of directions) {
      addRouteDirectionCone(scene, direction, routeDirectionMaterial)
    }

    for (const wind of winds) {
      addAloftWindArrow(scene, wind, windMaterial)
    }
  }

  function updateObjectScale() {
    if (!map || !scene) {
      return
    }

    const displayScale = getRouteObjectDisplayScale(map.getZoom())
    const showRouteDirections = map.getZoom() < routeGateMinZoom
    scene.traverse((object) => {
      if (object.userData.isRouteDisplayObject === true) {
        object.scale.setScalar(displayScale)
      }
      if (object.userData.routeObjectKind === 'direction') {
        object.visible = showRouteDirections
      }
    })
  }

  return {
    id: 'flightplan-3d-route-objects',
    type: 'custom',
    slot: 'top',
    renderingMode: '3d',
    onAdd(nextMap, gl) {
      map = nextMap
      camera = new THREE.Camera()
      scene = new THREE.Scene()
      renderer = new THREE.WebGLRenderer({
        canvas: nextMap.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      rebuildScene()
    },
    onRemove() {
      disposeScene()
      waypointMaterial.dispose()
      waypointHaloMaterial.dispose()
      routeDirectionMaterial.dispose()
      windMaterial.dispose()
      renderer?.dispose()
      map = null
      camera = null
      renderer = null
      scene = null
    },
    render(_gl, matrix) {
      if (!map || !camera || !renderer || !scene) {
        return
      }

      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix)
      updateObjectScale()
      renderer.resetState()
      renderer.clearDepth()
      renderer.render(scene, camera)
    },
    setRouteObjects(nextWaypoints, nextDirections, nextWinds) {
      waypoints = nextWaypoints
      directions = nextDirections
      winds = nextWinds
      rebuildScene()
      map?.triggerRepaint()
    },
  }
}

function createHoldingPatternLayer(initialHoldings: HoldingPattern3DObject[]): HoldingPatternCustomLayer {
  let map: mapboxgl.Map | null = null
  let camera: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let holdings = initialHoldings
  const material = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  function disposeScene() {
    if (!scene) {
      return
    }

    for (const child of [...scene.children]) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()

        const childMaterials = Array.isArray(child.material) ? child.material : [child.material]
        for (const childMaterial of childMaterials) {
          if (childMaterial !== material) {
            childMaterial.map?.dispose()
            childMaterial.dispose()
          }
        }
      }

      scene.remove(child)
    }
  }

  function rebuildScene() {
    if (!scene) {
      return
    }

    disposeScene()

    for (const holding of holdings) {
      addHoldingPatternMesh(scene, holding, material)
    }
  }

  function updateLabelRotations() {
    if (!map || !scene) {
      return
    }

    const labelRotationZ = holdingPatternLabelBaseRotationRad + THREE.MathUtils.degToRad(map.getBearing())
    for (const child of scene.children) {
      if (child instanceof THREE.Mesh && child.userData.isHoldingPatternLabel === true) {
        child.rotation.z = labelRotationZ
      }
    }
  }

  return {
    id: holdingPatternLayerId,
    type: 'custom',
    slot: 'top',
    renderingMode: '3d',
    onAdd(nextMap, gl) {
      map = nextMap
      camera = new THREE.Camera()
      scene = new THREE.Scene()
      renderer = new THREE.WebGLRenderer({
        canvas: nextMap.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      rebuildScene()
    },
    onRemove() {
      disposeScene()
      material.dispose()
      renderer?.dispose()
      map = null
      camera = null
      renderer = null
      scene = null
    },
    render(_gl, matrix) {
      if (!map || !camera || !renderer || !scene || map.getZoom() < holdingPatternMinZoom) {
        return
      }

      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix)
      updateLabelRotations()
      renderer.resetState()
      renderer.clearDepth()
      renderer.render(scene, camera)
    },
    setHoldings(nextHoldings) {
      holdings = nextHoldings
      rebuildScene()
      map?.triggerRepaint()
    },
  }
}

function createObstacleVolumeLayer(
  initialObstacles: Obstacle3DObject[],
  layerId = obstacleVolumeRenderLayerId,
): ObstacleVolumeCustomLayer {
  let map: mapboxgl.Map | null = null
  let camera: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let obstacles = initialObstacles
  const materials = new Map<string, THREE.MeshBasicMaterial>()
  const lightMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.96,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const auraMaterial = new THREE.MeshBasicMaterial({
    color: '#ef4444',
    transparent: true,
    opacity: 0.34,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  })

  function getMaterial(color: string) {
    const existing = materials.get(color)
    if (existing) {
      return existing
    }

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    materials.set(color, material)
    return material
  }

  function disposeScene() {
    if (!scene) {
      return
    }

    for (const child of [...scene.children]) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
      }
      scene.remove(child)
    }
  }

  function rebuildScene() {
    if (!map || !scene) {
      return
    }

    disposeScene()

    for (const obstacle of obstacles) {
      addShapeObstacleMesh(map, scene, obstacle, getMaterial(obstacle.color), lightMaterial, auraMaterial)
    }
  }

  return {
    id: layerId,
    type: 'custom',
    slot: 'top',
    renderingMode: '3d',
    onAdd(nextMap, gl) {
      map = nextMap
      camera = new THREE.Camera()
      scene = new THREE.Scene()
      renderer = new THREE.WebGLRenderer({
        canvas: nextMap.getCanvas(),
        context: gl,
        antialias: true,
      })
      renderer.autoClear = false
      rebuildScene()
    },
    onRemove() {
      disposeScene()
      for (const material of materials.values()) {
        material.dispose()
      }
      materials.clear()
      lightMaterial.dispose()
      auraMaterial.dispose()
      renderer?.dispose()
      map = null
      camera = null
      renderer = null
      scene = null
    },
    render(_gl, matrix) {
      if (!map || !camera || !renderer || !scene || map.getZoom() < obstacleVolume3DMinZoom) {
        return
      }

      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix)
      renderer.resetState()
      renderer.clearDepth()
      renderer.render(scene, camera)
    },
    setObstacles(nextObstacles) {
      obstacles = nextObstacles
      rebuildScene()
      map?.triggerRepaint()
    },
  }
}

function addGateFrameMeshes(
  scene: THREE.Scene,
  gate: RouteGateFrame,
  material: THREE.Material,
) {
  const center = mapboxgl.MercatorCoordinate.fromLngLat({ lng: gate.lon, lat: gate.lat }, 0)
  const centerScale = center.meterInMercatorCoordinateUnits()
  const ribHalfSize = routeGateRibHalfSizeMeters * centerScale
  const gateHalfWidth = routeGateHalfWidthNm * metersPerNm * centerScale
  const gateHeight = Math.max(routeGateRibHalfSizeMeters * 2, gate.heightMeters - gate.baseMeters)
  const gateLength = gateHalfWidth * 2 + ribHalfSize * 2
  const postHeight = Math.max(ribHalfSize * 2, (gateHeight - routeGateRibHalfSizeMeters * 2) * centerScale)
  const postAltitudeCenter = gate.baseMeters + routeGateRibHalfSizeMeters + (postHeight / centerScale) / 2
  const gateAxisAngle = getMercatorBearingAngle(gate.lat, gate.lon, gate.gateBearingDeg)

  addGateBox(scene, material, {
    lat: gate.lat,
    lon: gate.lon,
    altitudeMeters: gate.heightMeters,
    rotationZ: gateAxisAngle,
    size: [gateLength, ribHalfSize * 2, ribHalfSize * 2],
  })
  addGateBox(scene, material, {
    lat: gate.lat,
    lon: gate.lon,
    altitudeMeters: gate.baseMeters,
    rotationZ: gateAxisAngle,
    size: [gateLength, ribHalfSize * 2, ribHalfSize * 2],
  })

  for (const bearing of [gate.gateBearingDeg - 180, gate.gateBearingDeg]) {
    const [lon, lat] = destinationPoint(gate.lat, gate.lon, bearing, routeGateHalfWidthNm)
    addGateBox(scene, material, {
      lat,
      lon,
      altitudeMeters: postAltitudeCenter,
      rotationZ: gateAxisAngle,
      size: [ribHalfSize * 2, ribHalfSize * 2, postHeight],
    })
  }
}

function addGateBox(
  scene: THREE.Scene,
  material: THREE.Material,
  options: {
    lat: number
    lon: number
    altitudeMeters: number
    rotationZ: number
    size: [number, number, number]
  },
) {
  const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
    { lng: options.lon, lat: options.lat },
    options.altitudeMeters,
  )
  const geometry = new THREE.BoxGeometry(...options.size)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(coordinate.x, coordinate.y, coordinate.z)
  mesh.rotation.z = options.rotationZ
  scene.add(mesh)
}

function getMercatorRouteObjectTransform(lat: number, lon: number, altitudeMeters: number) {
  const coordinate = mapboxgl.MercatorCoordinate.fromLngLat({ lng: lon, lat }, altitudeMeters)
  return {
    coordinate,
    scale: coordinate.meterInMercatorCoordinateUnits(),
  }
}

function getRouteObjectDisplayScale(zoom: number) {
  if (zoom <= 6) return 72
  if (zoom <= 7) return 46
  if (zoom <= 8) return 28
  if (zoom <= 9) return 16
  if (zoom <= 10) return 9
  if (zoom <= 11) return 5
  if (zoom <= 12) return 3
  if (zoom <= 13) return 2
  return 1.25
}

function addRouteWaypointSphere(
  scene: THREE.Scene,
  waypoint: RouteWaypoint3DObject,
  material: THREE.Material,
  haloMaterial: THREE.Material,
) {
  const { coordinate, scale } = getMercatorRouteObjectTransform(waypoint.lat, waypoint.lon, waypoint.altitudeMeters)
  const halo = new THREE.Mesh(new THREE.SphereGeometry(routeWaypointRadiusMeters * 1.18 * scale, 24, 16), haloMaterial)
  halo.position.set(coordinate.x, coordinate.y, coordinate.z)
  halo.userData.isRouteDisplayObject = true
  halo.userData.routeObjectKind = 'waypoint'
  scene.add(halo)

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(routeWaypointRadiusMeters * 0.82 * scale, 28, 18), material)
  sphere.position.set(coordinate.x, coordinate.y, coordinate.z)
  sphere.userData.isRouteDisplayObject = true
  sphere.userData.routeObjectKind = 'waypoint'
  scene.add(sphere)
}

function addRouteDirectionCone(
  scene: THREE.Scene,
  direction: RouteDirection3DObject,
  material: THREE.Material,
) {
  const { coordinate, scale } = getMercatorRouteObjectTransform(direction.lat, direction.lon, direction.altitudeMeters)
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(routeDirectionConeRadiusMeters * scale, routeDirectionConeLengthMeters * scale, 28),
    material,
  )
  cone.position.set(coordinate.x, coordinate.y, coordinate.z)
  cone.rotation.z = getMercatorBearingAngle(direction.lat, direction.lon, direction.bearingDeg) - Math.PI / 2
  cone.userData.isRouteDisplayObject = true
  cone.userData.routeObjectKind = 'direction'
  scene.add(cone)
}

function addAloftWindArrow(
  scene: THREE.Scene,
  wind: AloftWind3DObject,
  material: THREE.Material,
) {
  const { coordinate, scale } = getMercatorRouteObjectTransform(wind.lat, wind.lon, wind.altitudeMeters)
  const group = new THREE.Group()
  const speedScale = Math.max(0.72, Math.min(1.55, wind.speedKt / 25))
  const shaftLength = aloftWindArrowLengthMeters * speedScale * scale
  const shaftRadius = aloftWindArrowRadiusMeters * scale
  const headLength = aloftWindArrowHeadLengthMeters * scale
  const headRadius = aloftWindArrowHeadRadiusMeters * scale
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16), material)
  shaft.position.y = -headLength / 2
  const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 24), material)
  head.position.y = shaftLength / 2
  group.add(shaft)
  group.add(head)
  group.position.set(coordinate.x, coordinate.y, coordinate.z)
  group.rotation.z = getMercatorBearingAngle(wind.lat, wind.lon, wind.directionDeg) - Math.PI / 2
  group.userData.isRouteDisplayObject = true
  group.userData.routeObjectKind = 'wind'
  scene.add(group)
}

function addHoldingPatternMesh(
  scene: THREE.Scene,
  holding: HoldingPattern3DObject,
  material: THREE.Material,
) {
  const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
    { lng: holding.lon, lat: holding.lat },
    holdingPatternAltitudeFt * feetToMeters,
  )
  const scale = coordinate.meterInMercatorCoordinateUnits()
  const radius = holdingPatternRadiusMeters * scale
  const tubeRadius = holdingPatternTubeMeters * scale
  const points = Array.from({ length: 57 }, (_, index) => {
    const angle = THREE.MathUtils.degToRad((300 * index) / 56)
    return new THREE.Vector3(
      Math.cos(angle) * radius,
      -Math.sin(angle) * radius,
      0,
    )
  })
  const path = new THREE.CatmullRomCurve3(points)
  const ringGeometry = new THREE.TubeGeometry(path, 64, tubeRadius, 8, false)
  const ring = new THREE.Mesh(ringGeometry, material)
  ring.position.set(coordinate.x, coordinate.y, coordinate.z)
  scene.add(ring)

  const arrowTip = points[points.length - 1]
  const arrowPrevious = points[points.length - 3]
  const arrowDirection = new THREE.Vector2(
    arrowTip.x - arrowPrevious.x,
    arrowTip.y - arrowPrevious.y,
  ).normalize()
  const arrowLength = radius * 0.34
  const arrowGeometry = new THREE.ConeGeometry(arrowLength * 0.36, arrowLength, 4)
  const arrow = new THREE.Mesh(arrowGeometry, material)
  arrow.position.set(coordinate.x + arrowTip.x, coordinate.y + arrowTip.y, coordinate.z)
  arrow.rotation.z = Math.atan2(-arrowDirection.x, arrowDirection.y)
  scene.add(arrow)

  const labelMesh = createHoldingPatternLabelMesh(holding.label, radius * 1.62, radius * 0.52)
  labelMesh.position.set(coordinate.x, coordinate.y, coordinate.z)
  scene.add(labelMesh)
}

function createHoldingPatternLabelMesh(label: string, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 192
  const context = canvas.getContext('2d')

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = '800 82px Inter, Space Grotesk, Arial, sans-serif'
    context.lineJoin = 'round'
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    context.lineWidth = 12
    context.strokeText(label, canvas.width / 2, canvas.height / 2)
    context.fillStyle = '#111827'
    context.fillText(label, canvas.width / 2, canvas.height / 2)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const geometry = new THREE.PlaneGeometry(width, height)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.z = holdingPatternLabelBaseRotationRad
  mesh.renderOrder = 10
  mesh.userData.isHoldingPatternLabel = true
  return mesh
}

function getObstacleShaftEndpointMeters(obstacle: Obstacle3DObject, lengthMeters: number) {
  const angleRad = getObstacleShaftAngleRad(obstacle.heightFt)

  return {
    x: Math.cos(angleRad) * lengthMeters,
    y: Math.sin(angleRad) * lengthMeters,
    angleRad,
  }
}

function getObstacleClockHour(heightFt: number | null) {
  return Math.max(1, Math.min(12, Math.round((heightFt ?? 300) / 100)))
}

function getObstacleShaftAngleRad(heightFt: number | null) {
  return ((getObstacleClockHour(heightFt) * 30 - 90) * Math.PI) / 180
}

function createCapsuleShape(length: number, width: number) {
  const radius = width / 2
  const shape = new THREE.Shape()
  shape.moveTo(0, -radius)
  shape.lineTo(length, -radius)
  shape.absarc(length, 0, radius, -Math.PI / 2, Math.PI / 2, false)
  shape.lineTo(0, radius)
  shape.absarc(0, 0, radius, Math.PI / 2, -Math.PI / 2, false)
  shape.closePath()
  return shape
}

function createWindTurbineDropShape(scaleMeters: number) {
  const shape = new THREE.Shape()
  const sx = (value: number) => (value - 18) * scaleMeters
  const sy = (value: number) => (value - 18) * scaleMeters

  shape.moveTo(sx(18), sy(7.5))
  shape.bezierCurveTo(sx(23.8), sy(7.5), sx(28.5), sy(12.1), sx(28.5), sy(17.8))
  shape.bezierCurveTo(sx(28.5), sy(22.2), sx(25.5), sy(25.4), sx(23), sy(29.2))
  shape.lineTo(sx(18), sy(40))
  shape.lineTo(sx(13), sy(29.2))
  shape.bezierCurveTo(sx(10.5), sy(25.4), sx(7.5), sy(22.2), sx(7.5), sy(17.8))
  shape.bezierCurveTo(sx(7.5), sy(12.1), sx(12.2), sy(7.5), sx(18), sy(7.5))
  shape.closePath()

  return shape
}

function createExtrudedShapeMesh(
  shape: THREE.Shape,
  heightMercator: number,
  material: THREE.Material,
) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: heightMercator,
    bevelEnabled: false,
    curveSegments: 18,
  })
  const mesh = new THREE.Mesh(geometry, material)
  return mesh
}

function addTemporaryObstacleAura(
  scene: THREE.Scene,
  obstacle: Obstacle3DObject,
  coordinate: mapboxgl.MercatorCoordinate,
  scale: number,
  auraMaterial: THREE.Material,
) {
  const groundOffset = 0.45 * scale

  if (obstacle.category === 'wind_turbine') {
    const shaftLengthMeters = 110
    const shaftWidthMeters = 42
    const shaftEndpoint = getObstacleShaftEndpointMeters(obstacle, shaftLengthMeters * scale)
    const shaftGeometry = new THREE.ShapeGeometry(createCapsuleShape(shaftLengthMeters * scale, shaftWidthMeters * scale), 16)
    const shaft = new THREE.Mesh(shaftGeometry, auraMaterial)
    shaft.rotation.z = shaftEndpoint.angleRad
    shaft.position.set(coordinate.x, coordinate.y, coordinate.z + groundOffset)
    scene.add(shaft)

    const dropGeometry = new THREE.ShapeGeometry(createWindTurbineDropShape(4.6 * scale), 24)
    const drop = new THREE.Mesh(dropGeometry, auraMaterial)
    drop.position.set(coordinate.x, coordinate.y, coordinate.z + groundOffset)
    scene.add(drop)
    return
  }

  const auraGeometry = new THREE.CircleGeometry(40 * scale, 36)
  const aura = new THREE.Mesh(auraGeometry, auraMaterial)
  aura.position.set(coordinate.x, coordinate.y, coordinate.z + groundOffset)
  scene.add(aura)
}

function addShapeObstacleMesh(
  map: mapboxgl.Map,
  scene: THREE.Scene,
  obstacle: Obstacle3DObject,
  material: THREE.Material,
  lightMaterial: THREE.Material,
  auraMaterial: THREE.Material,
) {
  const heightMeters = Math.max(12, obstacle.heightMeters)
  const terrainElevationMeters = map.queryTerrainElevation(
    { lng: obstacle.lon, lat: obstacle.lat },
    { exaggerated: false },
  ) ?? 0
  const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
    { lng: obstacle.lon, lat: obstacle.lat },
    terrainElevationMeters,
  )
  const scale = coordinate.meterInMercatorCoordinateUnits()
  const heightMercator = heightMeters * scale
  if (obstacle.temporary) {
    addTemporaryObstacleAura(scene, obstacle, coordinate, scale, auraMaterial)
  }

  if (obstacle.category === 'wind_turbine') {
    const drop = createExtrudedShapeMesh(createWindTurbineDropShape(2.25 * scale), heightMercator, material)
    drop.position.set(coordinate.x, coordinate.y, coordinate.z)
    scene.add(drop)

    if (obstacle.lighted) {
      const lightGeometry = new THREE.CylinderGeometry(8.8 * scale, 8.8 * scale, 1.2 * scale, 28)
      const light = new THREE.Mesh(lightGeometry, lightMaterial)
      light.position.set(coordinate.x, coordinate.y, coordinate.z + heightMercator + 0.8 * scale)
      light.rotation.x = Math.PI / 2
      scene.add(light)
    }
    return
  }

  const dotGeometry = new THREE.CylinderGeometry(11 * scale, 11 * scale, heightMercator, 28)
  const dot = new THREE.Mesh(dotGeometry, material)
  dot.position.set(coordinate.x, coordinate.y, coordinate.z + heightMercator / 2)
  dot.rotation.x = Math.PI / 2
  scene.add(dot)

  if (obstacle.lighted) {
    const lightGeometry = new THREE.CylinderGeometry(7 * scale, 7 * scale, 1.2 * scale, 28)
    const light = new THREE.Mesh(lightGeometry, lightMaterial)
    light.position.set(coordinate.x, coordinate.y, coordinate.z + heightMercator + 0.8 * scale)
    light.rotation.x = Math.PI / 2
    scene.add(light)
  }
}

function getMercatorBearingAngle(lat: number, lon: number, bearingDeg: number) {
  const origin = mapboxgl.MercatorCoordinate.fromLngLat({ lng: lon, lat }, 0)
  const [endLon, endLat] = destinationPoint(lat, lon, bearingDeg, 0.01)
  const end = mapboxgl.MercatorCoordinate.fromLngLat({ lng: endLon, lat: endLat }, 0)

  return Math.atan2(end.y - origin.y, end.x - origin.x)
}

function extractVerticalRangeFt(text: string) {
  const matches = [...text.matchAll(/\bFL\s*(\d{2,3})\b|(\d{3,5})\s*(?:FT|FEET)\s*(?:AMSL|MSL|AGL)?/gi)]
    .map((match) => (match[1] ? Number(match[1]) * 100 : Number(match[2])))
    .filter((value) => Number.isFinite(value) && value > 0)

  if (matches.length === 0) {
    return {
      lowerFt: notamVolumeBaseFt,
      upperFt: notamVolumeDefaultUpperFt,
    }
  }

  if (matches.length === 1) {
    return {
      lowerFt: notamVolumeBaseFt,
      upperFt: Math.max(matches[0], 500),
    }
  }

  return {
    lowerFt: Math.max(0, Math.min(...matches)),
    upperFt: Math.max(...matches),
  }
}

function getNotamColor(source: NotamMapOverlayFeature['source']) {
  if (source === 'notam-warning') {
    return '#ef4444'
  }

  if (source === 'aip-sup') {
    return '#6366f1'
  }

  return '#f59e0b'
}

function getNotamFeatureMarkerPosition(feature: NotamMapOverlayFeature): [number, number] {
  if (feature.kind === 'circle') {
    return feature.positions[0] ?? [0, 0]
  }

  if (feature.kind === 'polygon' && feature.positions.length > 0) {
    const totals = feature.positions.reduce(
      (current, [lat, lon]) => ({ lat: current.lat + lat, lon: current.lon + lon }),
      { lat: 0, lon: 0 },
    )
    return [totals.lat / feature.positions.length, totals.lon / feature.positions.length]
  }

  return feature.positions[0] ?? [0, 0]
}

function buildNotam3DGeoJson(features: NotamMapOverlayFeature[]) {
  const volumeFeatures: GeoJsonFeature[] = []
  const lineFeatures: GeoJsonFeature[] = []
  const pointFeatures: GeoJsonFeature[] = []

  for (const feature of features) {
    const color = getNotamColor(feature.source)
    const title = `${feature.label} · ${feature.title}`
    const verticalRange = extractVerticalRangeFt(feature.rawText)
    const properties = {
      id: feature.id,
      title,
      body: `${verticalRange.lowerFt} ft till ${verticalRange.upperFt} ft`,
      color,
      baseMeters: verticalRange.lowerFt * feetToMeters,
      heightMeters: Math.max((verticalRange.lowerFt + 500) * feetToMeters, verticalRange.upperFt * feetToMeters),
    }

    if (feature.visualKind === 'obstacle') {
      const [lat, lon] = getNotamFeatureMarkerPosition(feature)
      pointFeatures.push({
        type: 'Feature',
        properties: { id: feature.id, title, body: feature.source, color, category: 'notam', visualKind: feature.visualKind },
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
      })
      continue
    }

    if (feature.kind === 'circle' && feature.radiusNm != null) {
      const [lat, lon] = feature.positions[0] ?? []
      if (lat == null || lon == null) {
        continue
      }

      volumeFeatures.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: circlePolygonCoordinates(lat, lon, feature.radiusNm),
        },
      })
      continue
    }

    if (feature.kind === 'polygon' && feature.positions.length >= 3) {
      const coordinates = feature.positions.map(([lat, lon]) => [lon, lat])
      const first = coordinates[0]
      const last = coordinates[coordinates.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coordinates.push(first)
      }

      volumeFeatures.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates],
        },
      })
      continue
    }

    if (feature.kind === 'polyline') {
      lineFeatures.push({
        type: 'Feature',
        properties: { id: feature.id, title, body: feature.source, color },
        geometry: {
          type: 'LineString',
          coordinates: feature.positions.map(([lat, lon]) => [lon, lat]),
        },
      })
      continue
    }

    const [lat, lon] = feature.positions[0] ?? []
    if (lat == null || lon == null) {
      continue
    }

    pointFeatures.push({
      type: 'Feature',
      properties: { id: feature.id, title, body: feature.source, color, category: 'notam', visualKind: feature.visualKind ?? null },
      geometry: {
        type: 'Point',
        coordinates: [lon, lat],
      },
    })
  }

  return {
    volumes: { type: 'FeatureCollection', features: volumeFeatures } satisfies GeoJsonFeatureCollection,
    lines: { type: 'FeatureCollection', features: lineFeatures } satisfies GeoJsonFeatureCollection,
    points: { type: 'FeatureCollection', features: pointFeatures } satisfies GeoJsonFeatureCollection,
  }
}

function buildNotamObstacle3DObjects(features: NotamMapOverlayFeature[]) {
  return features.flatMap((feature): Obstacle3DObject[] => {
    if (feature.visualKind !== 'obstacle') {
      return []
    }

    const [lat, lon] = getNotamFeatureMarkerPosition(feature)
    const height = extractNotamObstacleHeight(feature.rawText)
    const heightMeters = Math.max(12, obstacleUnitToMeters(height.value, height.unit) ?? 60)
    const heightFt = notamObstacleHeightFt(feature.rawText)

    return [{
      id: feature.id,
      lat,
      lon,
      heightMeters,
      heightFt,
      color: getObstacle3DColorFromHeightFt(heightFt),
      category: inferNotamObstacleCategory(feature),
      lighted: /\b(?:LIGHTED|LGT|BELYST|LJUS)\b/i.test(feature.rawText),
      temporary: true,
    }]
  })
}

function getObstacleSymbolIconImageId(obstacle: Obstacle3DObject) {
  const kind = obstacle.category === 'wind_turbine' ? 'wind' : 'standard'
  const heightBand = obstacle.heightFt != null && obstacle.heightFt < 130 ? 'low' : 'high'
  const lighted = obstacle.lighted ? 'lighted' : 'unlighted'
  const temporary = obstacle.temporary ? 'temporary' : 'permanent'
  return `${obstacleIconIdPrefix}-${kind}-${heightBand}-${lighted}-${temporary}-clock-${getObstacleClockHour(obstacle.heightFt)}`
}

function buildNotamObstacleSymbolGeoJson(features: NotamMapOverlayFeature[]) {
  const obstacleById = new Map(buildNotamObstacle3DObjects(features).map((obstacle) => [obstacle.id, obstacle]))
  return {
    type: 'FeatureCollection',
    features: features.flatMap((feature): GeoJsonFeature[] => {
      if (feature.visualKind === 'obstacle-light-out') {
        const [lat, lon] = getNotamFeatureMarkerPosition(feature)
        return [{
          type: 'Feature',
          properties: {
            category: 'notam',
            id: feature.id,
            title: `${feature.label} · ${feature.title}`,
            body: feature.source,
            color: getNotamColor(feature.source),
            iconImage: obstacleLightOutIconId,
            symbolKind: 'obstacle-light-out',
          },
          geometry: { type: 'Point', coordinates: [lon, lat] },
        }]
      }

      const obstacle = obstacleById.get(feature.id)
      if (!obstacle) {
        return []
      }

      return [{
        type: 'Feature',
        properties: {
          category: 'notam',
          id: feature.id,
          title: `${feature.label} · ${feature.title}`,
          body: feature.source,
          color: obstacle.color,
          iconImage: getObstacleSymbolIconImageId(obstacle),
          symbolKind: 'obstacle',
        },
        geometry: { type: 'Point', coordinates: [obstacle.lon, obstacle.lat] },
      }]
    }),
  } satisfies GeoJsonFeatureCollection
}

function buildWeather3DGeoJson(overlays: RouteWeatherOverlay[]) {
  const areaFeatures: GeoJsonFeature[] = []
  const lineFeatures: GeoJsonFeature[] = []

  for (const overlay of overlays) {
    const properties = {
      id: overlay.id,
      title: overlay.firCodes[0] ?? 'SIGMET/ARS/AIRMET',
      body: `${overlay.matchSummary} · ${overlay.title}`,
      color: '#b44300',
    }

    if (overlay.geometry.type === 'polygon') {
      const coordinates = overlay.geometry.points.map((point) => [point.lon, point.lat])
      const first = coordinates[0]
      const last = coordinates[coordinates.length - 1]
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        coordinates.push(first)
      }
      areaFeatures.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [coordinates] } })
    } else if (overlay.geometry.type === 'multipolygon') {
      areaFeatures.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'MultiPolygon',
          coordinates: overlay.geometry.polygons.map((polygon) => {
            const coordinates = polygon.map((point) => [point.lon, point.lat])
            const first = coordinates[0]
            const last = coordinates[coordinates.length - 1]
            if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
              coordinates.push(first)
            }
            return [coordinates]
          }),
        },
      })
    } else if (overlay.geometry.type === 'circle') {
      areaFeatures.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: circlePolygonCoordinates(overlay.geometry.centre.lat, overlay.geometry.centre.lon, overlay.geometry.radiusNm),
        },
      })
    } else if (overlay.geometry.type === 'polyline') {
      lineFeatures.push({
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates: overlay.geometry.points.map((point) => [point.lon, point.lat]) },
      })
    } else {
      lineFeatures.push({
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: [overlay.geometry.point.lon, overlay.geometry.point.lat] },
      })
    }
  }

  return {
    areas: { type: 'FeatureCollection', features: areaFeatures } satisfies GeoJsonFeatureCollection,
    lines: { type: 'FeatureCollection', features: lineFeatures } satisfies GeoJsonFeatureCollection,
  }
}

function getRunwayLengthMeters(runway: SwedishAirport['runways'][number]) {
  const length = runway.dimensionsMeters?.match(/\d+(?:[.,]\d+)?/)?.[0]
  if (!length) {
    return 0
  }

  return Number(length.replace(',', '.')) || 0
}

function getRunwayBearingDegrees(runway: SwedishAirport['runways'][number]) {
  const designator = runway.designator.match(/\b([0-3]\d)[LCR]?\b/)?.[1]
  if (!designator) {
    return null
  }

  const runwayNumber = Number(designator)
  if (!Number.isFinite(runwayNumber) || runwayNumber < 1 || runwayNumber > 36) {
    return null
  }

  return runwayNumber === 36 ? 0 : runwayNumber * 10
}

function getLongestRunway(airport: SwedishAirport) {
  let longestRunway: SwedishAirport['runways'][number] | null = null
  let longestLengthMeters = -1

  for (const runway of airport.runways) {
    const lengthMeters = getRunwayLengthMeters(runway)
    if (lengthMeters > longestLengthMeters) {
      longestRunway = runway
      longestLengthMeters = lengthMeters
    }
  }

  return longestRunway
}

function getLongestRunwayLengthMeters(airport: SwedishAirport) {
  const longestRunway = getLongestRunway(airport)
  return longestRunway ? getRunwayLengthMeters(longestRunway) : 0
}

function getLongestRunwayBearingDegrees(airport: SwedishAirport) {
  const longestRunway = getLongestRunway(airport)
  return longestRunway ? getRunwayBearingDegrees(longestRunway) : null
}

function getAirportSymbolKind(airport: SwedishAirport) {
  const category = airport.category?.toLowerCase() ?? ''
  const longestRunwayLengthMeters = getLongestRunwayLengthMeters(airport)

  if (longestRunwayLengthMeters < 900) {
    return 'small'
  }

  if (category.includes('mil')) {
    return 'military'
  }

  return 'civil'
}

function getAirportWeatherColor(flightCategory: FlightplanMapboxAirportFlightCategory) {
  if (flightCategory === 'VMC') return '#16803c'
  if (flightCategory === 'MVMC') return '#b45309'
  if (flightCategory === 'IMC') return '#b91c1c'
  return '#64748b'
}

function buildMapPointGeoJson({
  airportFlightCategories,
  airports,
  navaids,
  showAirportSymbols,
  visualPoints,
}: {
  airportFlightCategories: Record<string, FlightplanMapboxAirportFlightCategory>
  airports: SwedishAirport[]
  navaids: SwedishNavaid[]
  showAirportSymbols: boolean
  visualPoints: SwedishVisualPoint[]
}) {
  const features: GeoJsonFeature[] = [
    ...airports.map((airport) => ({
      type: 'Feature' as const,
      properties: (() => {
        const flightCategory = airport.icao ? airportFlightCategories[airport.icao] ?? null : null
        const isWeatherIndicator = flightCategory != null
        const symbolKind = getAirportSymbolKind(airport)
        return {
          category: 'airport',
          id: airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`,
          label: getSwedishAirportMapLabel(airport),
          title: airport.icao ?? airport.name ?? 'Flygplats',
          body: airport.name ?? '',
          showAirportSymbol: showAirportSymbols,
          iconImage: symbolKind === 'small'
            ? mapPointIconIds.airportSmall
            : symbolKind === 'military'
              ? mapPointIconIds.airportMilitary
              : mapPointIconIds.airportCivil,
          weatherIconImage: flightCategory === 'VMC'
            ? mapPointIconIds.weatherVmc
            : flightCategory === 'MVMC'
              ? mapPointIconIds.weatherMvmc
              : flightCategory === 'IMC'
                ? mapPointIconIds.weatherImc
                : isWeatherIndicator
                  ? mapPointIconIds.weatherUnknown
                  : '',
          color: flightCategory === 'VMC'
            ? '#16803c'
            : flightCategory === 'MVMC'
              ? '#b45309'
              : flightCategory === 'IMC'
                ? '#b91c1c'
                : isWeatherIndicator
                  ? '#64748b'
                  : aeronauticalSymbolBlue,
          iconRotate: getLongestRunwayBearingDegrees(airport) ?? 0,
          iconSize: 0.72,
          weatherIconSize: 0.78,
          sortPriority: 80,
          weatherSortPriority: 90,
          flightCategory: flightCategory ?? 'NONE',
          flightCategoryLabel: flightCategory === 'VMC' ? 'V' : flightCategory === 'MVMC' ? 'M' : flightCategory === 'IMC' ? 'I' : '',
        }
      })(),
      geometry: { type: 'Point', coordinates: [airport.lon, airport.lat] },
    })),
    ...navaids.map((navaid) => ({
      type: 'Feature' as const,
      properties: {
        category: 'navaid',
          id: navaid.id,
          label: navaid.ident ?? navaid.kind,
          title: navaid.ident ?? navaid.name ?? navaid.kind,
          body: [navaid.kind, navaid.frequency, navaid.channel ? `Kanal ${navaid.channel}` : null].filter(Boolean).join(' · '),
          color: aeronauticalSymbolBlue,
          iconImage: navaid.kind === 'DME'
            ? mapPointIconIds.navaidDme
            : navaid.kind === 'NDB'
              ? mapPointIconIds.navaidNdb
              : navaid.kind === 'VOR'
                ? mapPointIconIds.navaidVor
                : mapPointIconIds.navaidDmev,
          iconRotate: 0,
          iconSize: 0.72,
          sortPriority: 10,
        },
      geometry: { type: 'Point', coordinates: [navaid.lon, navaid.lat] },
    })),
    ...visualPoints.map((point) => ({
      type: 'Feature' as const,
      properties: {
        category: 'visual-point',
        kind: point.kind,
        id: point.id,
        label: getSwedishVisualPointDisplayLabel(point),
        title: point.name ?? point.positionIndicator ?? 'VFR-punkt',
        body: point.kind,
        color: point.kind === 'holding' ? '#059669' : reportingPointColor,
        radius: 4,
        sortPriority: 20,
      },
      geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    })),
  ]

  return { type: 'FeatureCollection', features } satisfies GeoJsonFeatureCollection
}

function buildHoldingPattern3DObjects(visualPoints: SwedishVisualPoint[]) {
  return visualPoints
    .filter((point) => point.kind === 'holding')
    .map((point) => ({
      id: point.id,
      lat: point.lat,
      lon: point.lon,
      label: getSwedishVisualPointDisplayLabel(point),
    }))
}

function buildObstacle3DGeoJson(obstacles: SwedishObstacle[]) {
  const features = obstacles.map((obstacle) => {
    const obstacleHeightMeters = obstacleUnitToMeters(obstacle.heightValue, obstacle.heightUnit) ?? 60
    const baseMeters = 0
    const heightMeters = Math.max(12, obstacleHeightMeters)
    const color = getObstacle3DColor(obstacle)

    return {
      type: 'Feature' as const,
      properties: {
        category: 'obstacle',
        id: obstacle.id,
        title: obstacle.name ?? getObstacleDisplayType(obstacle),
        body: [
          getObstacleDisplayType(obstacle),
          obstacle.heightValue != null ? `Höjd ${Math.round(obstacle.heightValue)} ${obstacle.heightUnit ?? 'M'}` : null,
          obstacle.mslValue != null ? `MSL ${Math.round(obstacle.mslValue)} ${obstacle.mslUnit ?? 'M'}` : null,
          obstacle.lightingDescription ? `Ljus ${obstacle.lightingDescription}` : null,
          obstacle.cycleId ? `LFV ${obstacle.cycleId}` : null,
        ].filter(Boolean).join(' · '),
        color,
        baseMeters,
        heightMeters,
      },
      geometry: {
        type: 'Polygon',
        coordinates: obstacleFootprintCoordinates(obstacle.lat, obstacle.lon, getObstacle3DHitRadiusMeters(obstacle)),
      },
    }
  })

  return { type: 'FeatureCollection', features } satisfies GeoJsonFeatureCollection
}

function buildObstacle3DObjects(obstacles: SwedishObstacle[]) {
  return obstacles.map((obstacle) => ({
    id: obstacle.id,
    lat: obstacle.lat,
    lon: obstacle.lon,
    heightMeters: Math.max(12, obstacleUnitToMeters(obstacle.heightValue, obstacle.heightUnit) ?? 60),
    heightFt: obstacleHeightFt(obstacle),
    color: getObstacle3DColor(obstacle),
    category: obstacle.category,
    lighted: isObstacleLighted(obstacle),
  })) satisfies Obstacle3DObject[]
}

function buildObstacleSymbolGeoJson(obstacles: SwedishObstacle[]) {
  return {
    type: 'FeatureCollection',
    features: obstacles.map((sourceObstacle) => {
      const [obstacle] = buildObstacle3DObjects([sourceObstacle])
      return {
        type: 'Feature' as const,
        properties: {
          category: 'obstacle',
          id: sourceObstacle.id,
          title: sourceObstacle.name ?? getObstacleDisplayType(sourceObstacle),
          body: [
            getObstacleDisplayType(sourceObstacle),
            sourceObstacle.heightValue != null ? `Höjd ${Math.round(sourceObstacle.heightValue)} ${sourceObstacle.heightUnit ?? 'M'}` : null,
            sourceObstacle.mslValue != null ? `MSL ${Math.round(sourceObstacle.mslValue)} ${sourceObstacle.mslUnit ?? 'M'}` : null,
            sourceObstacle.lightingDescription ? `Ljus ${sourceObstacle.lightingDescription}` : null,
            sourceObstacle.cycleId ? `LFV ${sourceObstacle.cycleId}` : null,
          ].filter(Boolean).join(' · '),
          color: obstacle.color,
          iconImage: getObstacleSymbolIconImageId(obstacle),
        },
        geometry: { type: 'Point', coordinates: [sourceObstacle.lon, sourceObstacle.lat] },
      }
    }),
  } satisfies GeoJsonFeatureCollection
}

function buildAloftWindGeoJson(aloftWinds: RouteLegAloftWind[]) {
  return {
    type: 'FeatureCollection',
    features: aloftWinds.map((wind, index) => ({
      type: 'Feature',
      properties: {
        id: `wind-${index}`,
        direction: wind.direction,
        title: `Vind ${wind.direction}° / ${wind.speedKt} kt`,
        body: `${Math.round(wind.altitudeMetersMsl / feetToMeters)} ft · ${wind.requestedTime.replace('T', ' ')}`,
        color: '#0f172a',
      },
      geometry: { type: 'Point', coordinates: [wind.midpoint.lon, wind.midpoint.lat] },
    })),
  } satisfies GeoJsonFeatureCollection
}

function createMapPointIconImage(draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  context.scale(2, 2)
  draw(context)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function drawCircle(context: CanvasRenderingContext2D, x: number, y: number, radius: number, fillStyle: string | null, strokeStyle: string, lineWidth: number) {
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  if (fillStyle) {
    context.fillStyle = fillStyle
    context.fill()
  }
  context.strokeStyle = strokeStyle
  context.lineWidth = lineWidth
  context.stroke()
}

function drawHexagon(context: CanvasRenderingContext2D, fillStyle: string) {
  const points = [[18, 4], [30.1, 11], [30.1, 25], [18, 32], [5.9, 25], [5.9, 11]]
  context.beginPath()
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.closePath()
  context.fillStyle = fillStyle
  context.fill()
  context.strokeStyle = aeronauticalSymbolBlue
  context.lineWidth = 3
  context.lineJoin = 'round'
  context.stroke()
}

function drawRunway(context: CanvasRenderingContext2D) {
  context.fillStyle = 'rgba(255, 255, 255, 0.96)'
  context.strokeStyle = aeronauticalSymbolBlue
  context.lineWidth = 1.7
  context.beginPath()
  context.rect(15, 3.5, 6, 29)
  context.fill()
  context.stroke()
}

function createAirportIconImage(kind: 'small' | 'civil' | 'military') {
  return createMapPointIconImage((context) => {
    if (kind === 'small') {
      drawCircle(context, 18, 18, 10.5, 'rgba(255, 255, 255, 0.96)', aeronauticalSymbolBlue, 3)
      return
    }

    drawCircle(context, 18, 18, 9.5, kind === 'military' ? '#66a9df' : 'rgba(255, 255, 255, 0.96)', aeronauticalSymbolBlue, 3)
    drawRunway(context)
  })
}

function createNavaidIconImage(kind: SwedishNavaid['kind']) {
  return createMapPointIconImage((context) => {
    if (kind === 'NDB') {
      for (const [radius, lineWidth, dash] of [[14, 2.5, 4.1], [9, 2.3, 3.4], [5, 2.1, 2.7]] as const) {
        context.setLineDash([0.2, dash])
        context.lineCap = 'round'
        drawCircle(context, 18, 18, radius, null, aeronauticalSymbolBlue, lineWidth)
      }
      context.setLineDash([])
      context.fillStyle = aeronauticalSymbolBlue
      context.beginPath()
      context.arc(18, 18, 2, 0, Math.PI * 2)
      context.fill()
      return
    }

    if (kind === 'VOR') {
      drawHexagon(context, 'rgba(255, 255, 255, 0.96)')
      context.fillStyle = aeronauticalSymbolBlue
      context.beginPath()
      context.arc(18, 18, 2, 0, Math.PI * 2)
      context.fill()
      return
    }

    if (kind === 'DMEV') {
      drawHexagon(context, aeronauticalSymbolBlue)
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(18, 18, 2.3, 0, Math.PI * 2)
      context.fill()
      return
    }

    context.fillStyle = 'rgba(255, 255, 255, 0.96)'
    context.strokeStyle = aeronauticalSymbolBlue
    context.lineWidth = 3
    context.beginPath()
    context.rect(6, 6, 24, 24)
    context.fill()
    context.stroke()
    context.fillStyle = aeronauticalSymbolBlue
    context.beginPath()
    context.arc(18, 18, 2, 0, Math.PI * 2)
    context.fill()
  })
}

function createWeatherIconImage(color: string) {
  return createMapPointIconImage((context) => {
    drawCircle(context, 18, 18, 13, color, '#ffffff', 3)
  })
}

function createObstacleLightOutIconImage() {
  return createMapPointIconImage((context) => {
    context.lineCap = 'round'
    context.lineJoin = 'round'

    context.fillStyle = 'rgba(255, 255, 255, 0.94)'
    context.strokeStyle = '#ef4444'
    context.lineWidth = 3.2
    context.beginPath()
    context.arc(18, 18, 9, 0, Math.PI * 2)
    context.fill()
    context.stroke()

    context.fillStyle = '#facc15'
    context.strokeStyle = '#111827'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(19.6, 7.8)
    context.lineTo(12.7, 19)
    context.lineTo(17.5, 19)
    context.lineTo(16.4, 28.2)
    context.lineTo(23.3, 16.7)
    context.lineTo(18.5, 16.7)
    context.closePath()
    context.fill()
    context.stroke()

    context.strokeStyle = '#ef4444'
    context.lineWidth = 3.4
    context.beginPath()
    context.moveTo(11, 25)
    context.lineTo(25, 11)
    context.stroke()
  })
}

function createObstacleSymbolIconImage({
  category,
  color,
  heightFt,
  lighted,
  temporary,
}: {
  category: 'standard' | 'wind_turbine'
  color: string
  heightFt: number | null
  lighted: boolean
  temporary: boolean
}) {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  context.scale(2, 2)
  const center = { x: 24, y: 24 }
  const shaftAngleRad = getObstacleShaftAngleRad(heightFt)
  const shaftLength = 24.5
  const endpoint = {
    x: center.x + Math.cos(shaftAngleRad) * shaftLength,
    y: center.y + Math.sin(shaftAngleRad) * shaftLength,
  }
  const drawDrop = (scale = 1) => {
    const sx = (value: number) => center.x + (value - 18) * scale
    const sy = (value: number) => center.y + (value - 18) * scale
    context.beginPath()
    context.moveTo(sx(18), sy(7.5))
    context.bezierCurveTo(sx(23.8), sy(7.5), sx(28.5), sy(12.1), sx(28.5), sy(17.8))
    context.bezierCurveTo(sx(28.5), sy(22.2), sx(25.5), sy(25.4), sx(23), sy(29.2))
    context.lineTo(sx(18), sy(40))
    context.lineTo(sx(13), sy(29.2))
    context.bezierCurveTo(sx(10.5), sy(25.4), sx(7.5), sy(22.2), sx(7.5), sy(17.8))
    context.bezierCurveTo(sx(7.5), sy(12.1), sx(12.2), sy(7.5), sx(18), sy(7.5))
    context.closePath()
  }

  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (temporary) {
    context.strokeStyle = 'rgba(239, 68, 68, 0.5)'
    context.fillStyle = 'rgba(239, 68, 68, 0.18)'
    if (category === 'wind_turbine') {
      context.lineWidth = 8
      context.beginPath()
      context.moveTo(center.x, center.y)
      context.lineTo(endpoint.x, endpoint.y)
      context.stroke()
      drawDrop(1.08)
      context.lineWidth = 5
      context.stroke()
      context.fill()
    } else {
      context.lineWidth = 4
      context.beginPath()
      context.arc(center.x, center.y, 9, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
  }

  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = 4
  context.beginPath()
  context.moveTo(center.x, center.y)
  context.lineTo(endpoint.x, endpoint.y)
  context.stroke()

  if (category === 'wind_turbine') {
    drawDrop()
    context.fill()
    if (lighted) {
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(center.x, center.y, 4.7, 0, Math.PI * 2)
      context.fill()
    }
  } else {
    context.beginPath()
    context.arc(center.x, center.y, 5, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    if (lighted) {
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(center.x, center.y, 4.4, 0, Math.PI * 2)
      context.fill()
    }
  }

  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function ensureMapPointImages(map: mapboxgl.Map) {
  const iconImages: Array<[string, ImageData | null]> = [
    [mapPointIconIds.airportSmall, createAirportIconImage('small')],
    [mapPointIconIds.airportCivil, createAirportIconImage('civil')],
    [mapPointIconIds.airportMilitary, createAirportIconImage('military')],
    [mapPointIconIds.navaidDme, createNavaidIconImage('DME')],
    [mapPointIconIds.navaidNdb, createNavaidIconImage('NDB')],
    [mapPointIconIds.navaidVor, createNavaidIconImage('VOR')],
    [mapPointIconIds.navaidDmev, createNavaidIconImage('DMEV')],
    [mapPointIconIds.weatherVmc, createWeatherIconImage(getAirportWeatherColor('VMC'))],
    [mapPointIconIds.weatherMvmc, createWeatherIconImage(getAirportWeatherColor('MVMC'))],
    [mapPointIconIds.weatherImc, createWeatherIconImage(getAirportWeatherColor('IMC'))],
    [mapPointIconIds.weatherUnknown, createWeatherIconImage(getAirportWeatherColor('UNKNOWN'))],
  ]

  for (const [id, image] of iconImages) {
    if (image && !map.hasImage(id)) {
      map.addImage(id, image, { pixelRatio: 2 })
    }
  }
}

function ensureObstacleSymbolImages(map: mapboxgl.Map) {
  const iconImages: Array<[string, ImageData | null]> = [
    [obstacleLightOutIconId, createObstacleLightOutIconImage()],
  ]
  const heightVariants = [
    { color: '#732184', heightFt: 100 },
    ...Array.from({ length: 12 }, (_, index) => ({
      color: '#1f5db8',
      heightFt: index === 0 ? 130 : (index + 1) * 100,
    })),
  ]

  for (const category of ['standard', 'wind_turbine'] as const) {
    for (const { color, heightFt } of heightVariants) {
      for (const lighted of [false, true]) {
        for (const temporary of [false, true]) {
          const obstacle: Obstacle3DObject = {
            id: '',
            lat: 0,
            lon: 0,
            heightMeters: 60,
            heightFt,
            color,
            category: category === 'wind_turbine' ? 'wind_turbine' : 'other',
            lighted,
            temporary,
          }
          iconImages.push([
            getObstacleSymbolIconImageId(obstacle),
            createObstacleSymbolIconImage({ category, color, heightFt, lighted, temporary }),
          ])
        }
      }
    }
  }

  for (const [id, image] of iconImages) {
    if (image && !map.hasImage(id)) {
      map.addImage(id, image, { pixelRatio: 2 })
    }
  }
}

function updateOrCreateGeoJsonSource(map: mapboxgl.Map, id: string, data: GeoJsonFeatureCollection | GeoJsonFeature) {
  const source = map.getSource(id) as mapboxgl.GeoJSONSource | undefined
  if (source) {
    source.setData(data as unknown as GeoJSON.FeatureCollection)
    return
  }

  map.addSource(id, {
    type: 'geojson',
    data: data as unknown as GeoJSON.FeatureCollection,
    lineMetrics: id === routeSourceId,
  })
}

function isFiniteCamera(camera: MapboxCamera) {
  return Number.isFinite(camera.center[0]) &&
    Number.isFinite(camera.center[1]) &&
    Number.isFinite(camera.zoom) &&
    Number.isFinite(camera.pitch) &&
    Number.isFinite(camera.bearing)
}

function readStoredMapboxCamera(): MapboxCamera | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(mapboxCameraStorageKey) ?? 'null') as Partial<MapboxCamera> | null
    if (
      !parsed ||
      !Array.isArray(parsed.center) ||
      parsed.center.length !== 2 ||
      typeof parsed.zoom !== 'number' ||
      typeof parsed.pitch !== 'number' ||
      typeof parsed.bearing !== 'number'
    ) {
      return null
    }

    const camera: MapboxCamera = {
      center: [Number(parsed.center[0]), Number(parsed.center[1])],
      zoom: parsed.zoom,
      pitch: parsed.pitch,
      bearing: parsed.bearing,
    }

    return isFiniteCamera(camera) ? camera : null
  } catch {
    return null
  }
}

function writeStoredMapboxCamera(camera: MapboxCamera) {
  if (typeof window === 'undefined' || !isFiniteCamera(camera)) {
    return
  }

  window.localStorage.setItem(mapboxCameraStorageKey, JSON.stringify(camera))
}

function getMapCamera(map: mapboxgl.Map): MapboxCamera {
  const center = map.getCenter()
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  }
}

function getObstacleViewKey(view: FlightplanMapboxView) {
  return [
    view.zoom.toFixed(2),
    view.bounds.south.toFixed(4),
    view.bounds.west.toFixed(4),
    view.bounds.north.toFixed(4),
    view.bounds.east.toFixed(4),
  ].join('|')
}

function padMapboxBounds(bounds: FlightplanMapboxView['bounds'], ratio: number) {
  const latPadding = Math.abs(bounds.north - bounds.south) * ratio
  const lonPadding = Math.abs(bounds.east - bounds.west) * ratio

  return {
    south: bounds.south - latPadding,
    west: bounds.west - lonPadding,
    north: bounds.north + latPadding,
    east: bounds.east + lonPadding,
  }
}

function getInitialMapboxCamera(
  initialViewport: FlightplanMapboxInitialViewport | null,
  preferInitialViewport: boolean,
) {
  if (preferInitialViewport && initialViewport) {
    return {
      center: [initialViewport.center[1], initialViewport.center[0]],
      zoom: initialViewport.zoom,
      pitch: 68,
      bearing: 0,
    } satisfies MapboxCamera
  }

  return readStoredMapboxCamera() ?? swedenOverviewCamera
}

export function FlightplanMapbox3D({
  airspaces,
  airportFlightCategories,
  airports,
  aloftWinds,
  initialViewport,
  mapStyle,
  navaids,
  notamFeatures,
  showAirportSymbols,
  showObstacles,
  onMapViewChange,
  onInspectAirport,
  onInspectNavaid,
  onInspectNotamFeature,
  onInspectPoint,
  onInspectVisualPoint,
  onRoutePointAdd,
  plan,
  routeEditingEnabled,
  derived,
  visualPoints,
  weatherOverlays,
}: {
  airspaces: SwedishAirspace[]
  airportFlightCategories: Record<string, FlightplanMapboxAirportFlightCategory>
  airports: SwedishAirport[]
  aloftWinds: RouteLegAloftWind[]
  initialViewport: FlightplanMapboxInitialViewport | null
  mapStyle: FlightplanMapbox3DStyle
  navaids: SwedishNavaid[]
  notamFeatures: NotamMapOverlayFeature[]
  showAirportSymbols: boolean
  showObstacles: boolean
  onMapViewChange?: (view: FlightplanMapboxView) => void
  onInspectAirport: (airport: SwedishAirport) => void
  onInspectNavaid: (navaid: SwedishNavaid) => void
  onInspectNotamFeature: (feature: NotamMapOverlayFeature, lat: number, lon: number) => void
  onInspectPoint: (lat: number, lon: number) => void
  onInspectVisualPoint: (point: SwedishVisualPoint) => void
  onRoutePointAdd: (lat: number, lon: number) => void
  plan: FlightPlanInput
  routeEditingEnabled: boolean
  derived: FlightPlanDerived
  visualPoints: SwedishVisualPoint[]
  weatherOverlays: RouteWeatherOverlay[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const routeGateLayerRef = useRef<RouteGateCustomLayer | null>(null)
  const routeObjectsLayerRef = useRef<RouteObjectsCustomLayer | null>(null)
  const holdingPatternLayerRef = useRef<HoldingPatternCustomLayer | null>(null)
  const obstacleVolumeLayerRef = useRef<ObstacleVolumeCustomLayer | null>(null)
  const notamObstacleVolumeLayerRef = useRef<ObstacleVolumeCustomLayer | null>(null)
  const terrainErrorCountRef = useRef(0)
  const hasAppliedInitialViewportRef = useRef(false)
  const suppressNextMapClickRef = useRef(false)
  const [terrainDiagnostic, setTerrainDiagnostic] = useState<TerrainDiagnostic>(getInitialTerrainDiagnostic)
  const [mapboxObstacleView, setMapboxObstacleView] = useState<FlightplanMapboxObstacleView | null>(null)
  const [mapboxObstacles, setMapboxObstacles] = useState<SwedishObstacle[]>([])
  const routeProfile = useMemo(() => buildRouteProfile(plan, derived), [derived, plan])
  const route3DObjects = useMemo(
    () => buildRoute3DObjects(plan, derived, routeProfile.profilePoints),
    [derived, plan, routeProfile.profilePoints],
  )
  const routeWaypointGeoJson = useMemo(() => buildRouteWaypointGeoJson(plan), [plan])
  const airspaceGeoJson = useMemo(() => buildAirspaceGeoJson(airspaces), [airspaces])
  const notamGeoJson = useMemo(() => buildNotam3DGeoJson(notamFeatures), [notamFeatures])
  const notamObstacleObjects = useMemo(() => buildNotamObstacle3DObjects(notamFeatures), [notamFeatures])
  const weatherGeoJson = useMemo(() => buildWeather3DGeoJson(weatherOverlays), [weatherOverlays])
  const mapPointGeoJson = useMemo(
    () => buildMapPointGeoJson({ airportFlightCategories, airports, navaids, showAirportSymbols, visualPoints }),
    [airportFlightCategories, airports, navaids, showAirportSymbols, visualPoints],
  )
  const holdingPatternObjects = useMemo(() => buildHoldingPattern3DObjects(visualPoints), [visualPoints])
  const activeObstacles = useMemo(
    () => showObstacles && mapboxObstacleView && mapboxObstacleView.zoom >= obstacleVolumeMinZoom
      ? mapboxObstacles
      : emptyObstacles,
    [mapboxObstacleView, mapboxObstacles, showObstacles],
  )
  const obstacleGeoJson = useMemo(() => buildObstacle3DGeoJson(activeObstacles), [activeObstacles])
  const obstacleObjects = useMemo(() => buildObstacle3DObjects(activeObstacles), [activeObstacles])
  const obstacleSymbolGeoJson = useMemo(() => buildObstacleSymbolGeoJson(activeObstacles), [activeObstacles])
  const notamObstacleSymbolGeoJson = useMemo(() => buildNotamObstacleSymbolGeoJson(notamFeatures), [notamFeatures])
  const aloftWindGeoJson = useMemo(() => buildAloftWindGeoJson(aloftWinds), [aloftWinds])
  const aloftWindObjects = useMemo(() => buildAloftWind3DObjects(aloftWinds), [aloftWinds])
  const airportById = useMemo(() => new Map(airports.map((airport) => [airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`, airport])), [airports])
  const navaidById = useMemo(() => new Map(navaids.map((navaid) => [navaid.id, navaid])), [navaids])
  const visualPointById = useMemo(() => new Map(visualPoints.map((point) => [point.id, point])), [visualPoints])
  const notamFeatureById = useMemo(() => new Map(notamFeatures.map((feature) => [feature.id, feature])), [notamFeatures])
  const latestInspectRef = useRef({
    airportById,
    navaidById,
    notamFeatureById,
    onInspectAirport,
    onInspectNavaid,
    onInspectNotamFeature,
    onInspectPoint,
    onInspectVisualPoint,
    onRoutePointAdd,
    routeEditingEnabled,
    visualPointById,
  })
  const latestViewChangeRef = useRef(onMapViewChange)
  const latestMapDataRef = useRef({
    airspaceGeoJson,
    aloftWindGeoJson,
    aloftWindObjects,
    holdingPatternObjects,
    mapPointGeoJson,
    notamGeoJson,
    notamObstacleObjects,
    notamObstacleSymbolGeoJson,
    obstacleGeoJson,
    obstacleObjects,
    obstacleSymbolGeoJson,
    plan,
    routeProfile,
    route3DObjects,
    routeWaypointGeoJson,
    weatherGeoJson,
  })

  useEffect(() => {
    latestViewChangeRef.current = onMapViewChange
  }, [onMapViewChange])

  useEffect(() => {
    latestMapDataRef.current = {
      airspaceGeoJson,
      aloftWindGeoJson,
      aloftWindObjects,
      holdingPatternObjects,
      mapPointGeoJson,
      notamGeoJson,
      notamObstacleObjects,
      notamObstacleSymbolGeoJson,
      obstacleGeoJson,
      obstacleObjects,
      obstacleSymbolGeoJson,
      plan,
      routeProfile,
      route3DObjects,
      routeWaypointGeoJson,
      weatherGeoJson,
    }
  }, [airspaceGeoJson, aloftWindGeoJson, aloftWindObjects, holdingPatternObjects, mapPointGeoJson, notamGeoJson, notamObstacleObjects, notamObstacleSymbolGeoJson, obstacleGeoJson, obstacleObjects, obstacleSymbolGeoJson, plan, route3DObjects, routeProfile, routeWaypointGeoJson, weatherGeoJson])

  useEffect(() => {
    latestInspectRef.current = {
      airportById,
      navaidById,
      notamFeatureById,
      onInspectAirport,
      onInspectNavaid,
      onInspectNotamFeature,
      onInspectPoint,
      onInspectVisualPoint,
      onRoutePointAdd,
      routeEditingEnabled,
      visualPointById,
    }
  }, [
    airportById,
    navaidById,
    notamFeatureById,
    onInspectAirport,
    onInspectNavaid,
    onInspectNotamFeature,
    onInspectPoint,
    onInspectVisualPoint,
    onRoutePointAdd,
    routeEditingEnabled,
    visualPointById,
  ])

  useEffect(() => {
    if (!containerRef.current || !mapboxAccessToken || mapRef.current) {
      return
    }

    mapboxgl.accessToken = mapboxAccessToken
    const initialCamera = getInitialMapboxCamera(initialViewport, !hasAppliedInitialViewportRef.current)
    hasAppliedInitialViewportRef.current = true
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapboxStyleUrls[mapStyle],
      projection: 'mercator',
      center: initialCamera.center,
      zoom: initialCamera.zoom,
      pitch: initialCamera.pitch,
      bearing: initialCamera.bearing,
      antialias: true,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    let viewRefreshFrameId: number | null = null
    const viewRefreshTimeoutIds = new Set<number>()
    const persistCamera = () => writeStoredMapboxCamera(getMapCamera(map))
    const emitMapView = () => {
      const bounds = map.getBounds()
      if (!bounds) {
        return
      }

      const view = {
        bounds: {
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
        },
        zoom: map.getZoom(),
      }
      const key = getObstacleViewKey(view)
      setMapboxObstacleView((current) => current?.key === key ? current : { ...view, key })
      latestViewChangeRef.current?.(view)
    }
    const handleViewChange = () => {
      persistCamera()
      emitMapView()
    }
    const refreshObstacleTerrain = () => {
      obstacleVolumeLayerRef.current?.setObstacles(latestMapDataRef.current.obstacleObjects)
      notamObstacleVolumeLayerRef.current?.setObstacles(latestMapDataRef.current.notamObstacleObjects)
    }
    const refreshMapView = () => {
      if (viewRefreshFrameId != null) {
        window.cancelAnimationFrame(viewRefreshFrameId)
      }

      viewRefreshFrameId = window.requestAnimationFrame(() => {
        viewRefreshFrameId = null
        map.resize()
        emitMapView()
      })
    }
    map.on('moveend', handleViewChange)
    map.on('zoomend', handleViewChange)
    map.on('pitchend', persistCamera)
    map.on('rotateend', persistCamera)
    map.on('idle', refreshObstacleTerrain)
    map.once('load', refreshMapView)
    map.once('idle', refreshMapView)
    map.once('render', refreshMapView)
    map.once('styledata', refreshMapView)
    refreshMapView()
    for (const delayMs of [80, 240, 650, 1400, 2600]) {
      const timeoutId = window.setTimeout(() => {
        viewRefreshTimeoutIds.delete(timeoutId)
        refreshMapView()
      }, delayMs)
      viewRefreshTimeoutIds.add(timeoutId)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshMapView)
    resizeObserver?.observe(containerRef.current)

    map.on('error', (event) => {
      const message = getMapboxErrorMessage(event.error)
      const sourceId = 'sourceId' in event && typeof event.sourceId === 'string' ? event.sourceId : ''
      const isTerrainError = sourceId === terrainSourceId || /terrain|raster-dem|dem|mapbox-terrain/i.test(message)

      if (!isTerrainError) {
        return
      }

      terrainErrorCountRef.current += 1
      setTerrainDiagnostic({
        status: 'degraded',
        message: '3D-terräng kan vara blockerad',
        details: 'Om kartan är platt i Brave: stäng av Shields för sidan eller tillåt Mapbox/WebGL-resurser.',
      })
    })

    const installStyleLayers = async () => {
      if (map.getLayer(airspaceLayerId)) {
        updateOrCreateGeoJsonSource(map, obstacleVolumeSourceId, latestMapDataRef.current.obstacleGeoJson)
        updateOrCreateGeoJsonSource(map, obstacleSymbolSourceId, latestMapDataRef.current.obstacleSymbolGeoJson)
        updateOrCreateGeoJsonSource(map, notamObstacleSymbolSourceId, latestMapDataRef.current.notamObstacleSymbolGeoJson)
        obstacleVolumeLayerRef.current?.setObstacles(latestMapDataRef.current.obstacleObjects)
        notamObstacleVolumeLayerRef.current?.setObstacles(latestMapDataRef.current.notamObstacleObjects)
        routeObjectsLayerRef.current?.setRouteObjects(
          latestMapDataRef.current.route3DObjects.waypoints,
          latestMapDataRef.current.route3DObjects.directions,
          latestMapDataRef.current.aloftWindObjects,
        )
        refreshMapView()
        return
      }

      obstacleVolumeLayerRef.current = null
      notamObstacleVolumeLayerRef.current = null
      map.addSource(terrainSourceId, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain({ source: terrainSourceId, exaggeration: terrainExaggeration })
      window.setTimeout(() => {
        const hasTerrain = Boolean(map.getTerrain()?.source === terrainSourceId)
        const hasTerrainSource = Boolean(map.getSource(terrainSourceId))

        if (!hasTerrain || !hasTerrainSource) {
          setTerrainDiagnostic({
            status: 'error',
            message: '3D-terräng kunde inte aktiveras',
            details: 'Webbläsaren laddade inte Mapbox terrain. Kontrollera WebGL/grafikacceleration eller Brave Shields.',
          })
          return
        }

        setTerrainDiagnostic((current) => {
          if (current.status === 'degraded' || terrainErrorCountRef.current > 0) {
            return current
          }

          return {
            status: 'ready',
            message: `Terräng x${terrainExaggeration}`,
            details: null,
          }
        })
      }, 1200)
      map.setFog({
        color: 'rgb(230, 236, 242)',
        'high-color': 'rgb(170, 200, 230)',
        'horizon-blend': 0.18,
      })

      const labelLayerId = map.getStyle().layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id
      map.addLayer({
        id: buildingsLayerId,
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', ['get', 'extrude'], 'true'],
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#b9c0c8',
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 0],
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.48,
        },
      }, labelLayerId)

      const latestMapData = latestMapDataRef.current
      emitMapView()

      updateOrCreateGeoJsonSource(map, airspaceSourceId, latestMapData.airspaceGeoJson)
      map.addLayer({
        id: airspaceLayerId,
        type: 'fill-extrusion',
        source: airspaceSourceId,
        paint: {
          'fill-extrusion-color': getMapboxAirspaceFillColorExpression(),
          'fill-extrusion-base': ['get', 'baseMeters'],
          'fill-extrusion-height': ['get', 'heightMeters'],
          'fill-extrusion-opacity': airspaceFillOpacity,
          'fill-extrusion-vertical-gradient': false,
        },
      })
      map.addLayer({
        id: airspaceHitLayerId,
        type: 'fill',
        source: airspaceSourceId,
        paint: {
          'fill-color': '#000000',
          'fill-opacity': 0.001,
        },
      })
      map.addLayer({
        id: airspaceBaseOutlineLayerId,
        type: 'line',
        source: airspaceSourceId,
        paint: {
          'line-color': getMapboxAirspaceColorExpression(),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.1, 10, 1.8, 14, 3.2],
          'line-opacity': airspaceOutlineOpacity,
          'line-dasharray': getMapboxAirspaceDashArrayExpression(),
        },
      })
      map.addLayer({
        id: airspaceBaseHighlightLayerId,
        type: 'line',
        source: airspaceSourceId,
        filter: idMatchFilter([]),
        paint: {
          'line-color': getMapboxAirspaceColorExpression(),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.8, 10, 4.4, 14, 6.4],
          'line-opacity': 1,
          'line-dasharray': getMapboxAirspaceDashArrayExpression(),
        },
      })
      map.addLayer({
        id: airspaceOutlineLayerId,
        type: 'line',
        source: airspaceSourceId,
        layout: {
          'line-elevation-reference': 'sea',
          'line-z-offset': ['get', 'heightMeters'],
        },
        paint: {
          'line-color': getMapboxAirspaceColorExpression(),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 2.2, 14, 3.8],
          'line-opacity': airspaceUpperOutlineOpacity,
          'line-dasharray': getMapboxAirspaceDashArrayExpression(),
        },
      })
      map.addLayer({
        id: airspaceHighlightLayerId,
        type: 'line',
        source: airspaceSourceId,
        filter: idMatchFilter([]),
        layout: {
          'line-elevation-reference': 'sea',
          'line-z-offset': ['get', 'heightMeters'],
        },
        paint: {
          'line-color': getMapboxAirspaceColorExpression(),
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.2, 10, 5, 14, 7.2],
          'line-opacity': 1,
          'line-dasharray': getMapboxAirspaceDashArrayExpression(),
        },
      })
      map.on('mouseenter', airspaceHitLayerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', airspaceHitLayerId, () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', airspaceHitLayerId, (event) => {
        const feature = event.features?.[0]
        if (!feature) {
          return
        }

        suppressNextMapClickRef.current = true
        if (latestInspectRef.current.routeEditingEnabled) {
          latestInspectRef.current.onRoutePointAdd(event.lngLat.lat, event.lngLat.lng)
          return
        }

        latestInspectRef.current.onInspectPoint(event.lngLat.lat, event.lngLat.lng)
      })
      updateOrCreateGeoJsonSource(map, notamVolumeSourceId, latestMapData.notamGeoJson.volumes)
      map.addLayer({
        id: notamVolumeLayerId,
        type: 'fill-extrusion',
        source: notamVolumeSourceId,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-base': ['get', 'baseMeters'],
          'fill-extrusion-height': ['get', 'heightMeters'],
          'fill-extrusion-opacity': notamVolumeFillOpacity,
          'fill-extrusion-vertical-gradient': false,
        },
      })
      map.addLayer({
        id: notamVolumeOutlineLayerId,
        type: 'line',
        source: notamVolumeSourceId,
        layout: {
          'line-elevation-reference': 'sea',
          'line-z-offset': ['get', 'heightMeters'],
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 10, 2.4, 14, 4],
          'line-opacity': 0.96,
          'line-dasharray': [2, 1.4],
        },
      })
      map.addLayer({
        id: notamVolumeHighlightLayerId,
        type: 'line',
        source: notamVolumeSourceId,
        filter: idMatchFilter([]),
        layout: {
          'line-elevation-reference': 'sea',
          'line-z-offset': ['get', 'heightMeters'],
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.2, 10, 5, 14, 7],
          'line-opacity': 1,
          'line-dasharray': [2, 1.4],
        },
      })
      updateOrCreateGeoJsonSource(map, notamLineSourceId, latestMapData.notamGeoJson.lines)
      map.addLayer({
        id: notamLineLayerId,
        type: 'line',
        source: notamLineSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 12, 3.5],
          'line-opacity': 0.9,
          'line-dasharray': [2, 1.4],
        },
      })
      map.addLayer({
        id: notamLineHighlightLayerId,
        type: 'line',
        source: notamLineSourceId,
        filter: idMatchFilter([]),
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.4, 12, 6.4],
          'line-opacity': 1,
          'line-dasharray': [2, 1.4],
        },
      })
      updateOrCreateGeoJsonSource(map, notamPointSourceId, latestMapData.notamGeoJson.points)
      map.addLayer({
        id: notamPointLayerId,
        type: 'circle',
        source: notamPointSourceId,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 8],
          'circle-opacity': ['match', ['get', 'visualKind'], ['obstacle', 'obstacle-light-out'], 0.001, 1],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': ['match', ['get', 'visualKind'], ['obstacle', 'obstacle-light-out'], 0.001, 1],
        },
      })
      map.addLayer({
        id: notamPointHighlightLayerId,
        type: 'circle',
        source: notamPointSourceId,
        filter: idMatchFilter([]),
        paint: {
          'circle-color': 'rgba(255, 255, 255, 0)',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 8, 12, 13],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 3,
          'circle-stroke-opacity': 1,
        },
      })

      ensureObstacleSymbolImages(map)
      updateOrCreateGeoJsonSource(map, obstacleSymbolSourceId, latestMapData.obstacleSymbolGeoJson)
      map.addLayer({
        id: obstacleSymbolLayerId,
        type: 'symbol',
        source: obstacleSymbolSourceId,
        minzoom: obstacleVolumeMinZoom,
        maxzoom: obstacleVolume3DMinZoom,
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-size': 0.72,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      updateOrCreateGeoJsonSource(map, notamObstacleSymbolSourceId, latestMapData.notamObstacleSymbolGeoJson)
      map.addLayer({
        id: notamObstacleSymbolLayerId,
        type: 'symbol',
        source: notamObstacleSymbolSourceId,
        minzoom: obstacleVolumeMinZoom,
        maxzoom: obstacleVolume3DMinZoom,
        filter: ['!=', ['get', 'symbolKind'], 'obstacle-light-out'],
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-size': 0.72,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      map.addLayer({
        id: notamObstacleLightOutSymbolLayerId,
        type: 'symbol',
        source: notamObstacleSymbolSourceId,
        minzoom: obstacleVolumeMinZoom,
        filter: ['==', ['get', 'symbolKind'], 'obstacle-light-out'],
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-size': 0.78,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      updateOrCreateGeoJsonSource(map, weatherAreaSourceId, latestMapData.weatherGeoJson.areas)
      map.addLayer({
        id: weatherAreaHaloLayerId,
        type: 'line',
        source: weatherAreaSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 9, 10, 16, 13, 26],
          'line-opacity': 0.09,
          'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 6, 13, 12],
        },
      })
      map.addLayer({
        id: weatherAreaSoftEdgeLayerId,
        type: 'line',
        source: weatherAreaSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 9, 13, 15],
          'line-opacity': 0.18,
          'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 3, 13, 7],
        },
      })
      map.addLayer({
        id: weatherAreaLayerId,
        type: 'fill',
        source: weatherAreaSourceId,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.14,
          'fill-outline-color': ['get', 'color'],
        },
      })
      updateOrCreateGeoJsonSource(map, weatherLineSourceId, latestMapData.weatherGeoJson.lines)
      map.addLayer({
        id: weatherLineLayerId,
        type: 'line',
        source: weatherLineSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 12, 3.2],
          'line-opacity': 0.9,
          'line-dasharray': [3, 2],
        },
      })

      updateOrCreateGeoJsonSource(map, obstacleVolumeSourceId, latestMapData.obstacleGeoJson)
      map.addLayer({
        id: obstacleVolumeLayerId,
        type: 'fill',
        source: obstacleVolumeSourceId,
        slot: 'top',
        minzoom: obstacleVolume3DMinZoom,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.001,
        },
      })
      map.addLayer({
        id: obstacleVolumeOutlineLayerId,
        type: 'line',
        source: obstacleVolumeSourceId,
        slot: 'top',
        minzoom: obstacleVolume3DMinZoom,
        layout: {
          'line-elevation-reference': 'ground',
          'line-z-offset': ['get', 'heightMeters'],
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 13, 2.4],
          'line-opacity': 0,
        },
      })
      const obstacleRenderLayer = createObstacleVolumeLayer(latestMapData.obstacleObjects)
      obstacleVolumeLayerRef.current = obstacleRenderLayer
      map.addLayer(obstacleRenderLayer)
      const notamObstacleRenderLayer = createObstacleVolumeLayer(latestMapData.notamObstacleObjects, notamObstacleVolumeRenderLayerId)
      notamObstacleVolumeLayerRef.current = notamObstacleRenderLayer
      map.addLayer(notamObstacleRenderLayer)

      updateOrCreateGeoJsonSource(map, mapPointSourceId, latestMapData.mapPointGeoJson)
      ensureMapPointImages(map)
      map.addLayer({
        id: mapPointNavaidLayerId,
        type: 'symbol',
        source: mapPointSourceId,
        minzoom: mapPointSymbolMinZoom,
        filter: ['==', ['get', 'category'], 'navaid'],
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-size': ['get', 'iconSize'],
          'icon-pitch-alignment': 'map',
          'icon-rotation-alignment': 'map',
          'symbol-sort-key': ['get', 'sortPriority'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      map.addLayer({
        id: mapPointAirportLayerId,
        type: 'symbol',
        source: mapPointSourceId,
        minzoom: airportSymbolMinZoom,
        filter: [
          'all',
          ['==', ['get', 'category'], 'airport'],
          ['==', ['get', 'showAirportSymbol'], true],
          ['==', ['get', 'flightCategoryLabel'], ''],
        ],
        layout: {
          'icon-image': ['get', 'iconImage'],
          'icon-size': ['get', 'iconSize'],
          'icon-rotate': ['get', 'iconRotate'],
          'icon-pitch-alignment': 'map',
          'icon-rotation-alignment': 'map',
          'symbol-sort-key': ['get', 'sortPriority'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      map.addLayer({
        id: mapPointEntryExitLayerId,
        type: 'symbol',
        source: mapPointSourceId,
        minzoom: reportingPointSymbolMinZoom,
        filter: ['all', ['==', ['get', 'category'], 'visual-point'], ['==', ['get', 'kind'], 'entry-exit']],
        layout: {
          'text-field': '▲',
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 18, 13, 26],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'symbol-sort-key': ['get', 'sortPriority'],
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 0.8,
        },
      })
      const holdingPatternLayer = createHoldingPatternLayer(latestMapData.holdingPatternObjects)
      holdingPatternLayerRef.current = holdingPatternLayer
      map.addLayer(holdingPatternLayer)
      map.addLayer({
        id: airportWeatherIconLayerId,
        type: 'symbol',
        source: mapPointSourceId,
        filter: ['all', ['==', ['get', 'category'], 'airport'], ['!=', ['get', 'flightCategoryLabel'], '']],
        layout: {
          'icon-image': ['get', 'weatherIconImage'],
          'icon-size': ['get', 'weatherIconSize'],
          'icon-pitch-alignment': 'map',
          'icon-rotation-alignment': 'map',
          'symbol-sort-key': ['get', 'weatherSortPriority'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      map.addLayer({
        id: airportWeatherLabelLayerId,
        type: 'symbol',
        source: mapPointSourceId,
        filter: ['all', ['==', ['get', 'category'], 'airport'], ['!=', ['get', 'flightCategoryLabel'], '']],
        layout: {
          'text-field': ['get', 'flightCategoryLabel'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 16],
          'text-pitch-alignment': 'map',
          'text-rotation-alignment': 'map',
          'symbol-sort-key': ['get', 'weatherSortPriority'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': ['get', 'color'],
          'text-halo-width': 1,
        },
      })
      map.addLayer({
        id: mapPointLabelLayerId,
        type: 'symbol',
        source: mapPointSourceId,
        minzoom: reportingPointLabelMinZoom,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 13],
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        filter: ['!', ['all', ['==', ['get', 'category'], 'visual-point'], ['==', ['get', 'kind'], 'holding']]],
        paint: {
          'text-color': [
            'case',
            ['==', ['get', 'category'], 'airport'],
            aeronauticalSymbolBlue,
            ['all', ['==', ['get', 'category'], 'visual-point'], ['==', ['get', 'kind'], 'entry-exit']],
            reportingPointColor,
            '#0f172a',
          ],
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      })

      updateOrCreateGeoJsonSource(map, aloftWindSourceId, latestMapData.aloftWindGeoJson)
      map.addLayer({
        id: aloftWindLayerId,
        type: 'circle',
        source: aloftWindSourceId,
        paint: {
          'circle-color': '#0f766e',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 14, 11, 28],
          'circle-opacity': 0.001,
        },
      })

      const genericPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
      const popupLayers = [
        obstacleVolumeLayerId,
        obstacleSymbolLayerId,
        notamObstacleSymbolLayerId,
        notamObstacleLightOutSymbolLayerId,
        notamPointLayerId,
        notamLineLayerId,
        mapPointNavaidLayerId,
        mapPointAirportLayerId,
        mapPointEntryExitLayerId,
        airportWeatherIconLayerId,
        airportWeatherLabelLayerId,
        mapPointLabelLayerId,
        aloftWindLayerId,
      ]
      for (const layerId of popupLayers) {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mousemove', layerId, (event) => {
          const feature = event.features?.[0]
          if (!feature) {
            return
          }
          genericPopup.setLngLat(event.lngLat).setHTML(formatGenericPopup(feature.properties)).addTo(map)
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
          genericPopup.remove()
        })
        map.on('click', layerId, (event) => {
          const feature = event.features?.[0]
          if (!feature) {
            return
          }

          suppressNextMapClickRef.current = true
          const properties = feature.properties
          const id = String(properties?.id ?? '')
          const category = String(properties?.category ?? '')
          const latestInspect = latestInspectRef.current
          const isMapPointInteraction = layerId === mapPointNavaidLayerId || layerId === mapPointAirportLayerId || layerId === mapPointEntryExitLayerId || layerId === airportWeatherIconLayerId || layerId === airportWeatherLabelLayerId || layerId === mapPointLabelLayerId

          if (isMapPointInteraction && category === 'airport') {
            const airport = latestInspect.airportById.get(id)
            if (airport) {
              if (latestInspect.routeEditingEnabled) {
                latestInspect.onRoutePointAdd(airport.lat, airport.lon)
                return
              }

              latestInspect.onInspectAirport(airport)
              return
            }
          }

          if (isMapPointInteraction && category === 'navaid') {
            const navaid = latestInspect.navaidById.get(id)
            if (navaid) {
              if (latestInspect.routeEditingEnabled) {
                latestInspect.onRoutePointAdd(navaid.lat, navaid.lon)
                return
              }

              latestInspect.onInspectNavaid(navaid)
              return
            }
          }

          if (isMapPointInteraction && category === 'visual-point') {
            const visualPoint = latestInspect.visualPointById.get(id)
            if (visualPoint) {
              if (latestInspect.routeEditingEnabled) {
                latestInspect.onRoutePointAdd(visualPoint.lat, visualPoint.lon)
                return
              }

              latestInspect.onInspectVisualPoint(visualPoint)
              return
            }
          }

          if (latestInspect.routeEditingEnabled) {
            latestInspect.onRoutePointAdd(event.lngLat.lat, event.lngLat.lng)
            return
          }

          if (layerId === notamVolumeLayerId || layerId === notamLineLayerId || layerId === notamPointLayerId || layerId === notamObstacleSymbolLayerId || layerId === notamObstacleLightOutSymbolLayerId) {
            const notamFeature = latestInspect.notamFeatureById.get(id)
            if (notamFeature) {
              latestInspect.onInspectNotamFeature(notamFeature, event.lngLat.lat, event.lngLat.lng)
              return
            }
          }

          new mapboxgl.Popup({ offset: 14 }).setLngLat(event.lngLat).setHTML(formatGenericPopup(properties)).addTo(map)
        })
      }

      const hoverHighlightLayers = [
        airspaceHitLayerId,
        notamVolumeLayerId,
        notamLineLayerId,
        notamPointLayerId,
      ]
      const updateHoverHighlights = (event: mapboxgl.MapMouseEvent) => {
        const renderedFeatures = map.queryRenderedFeatures(event.point, { layers: hoverHighlightLayers })
        const airspaceIds = getRenderedFeatureIds(
          renderedFeatures.filter((feature) => feature.source === airspaceSourceId),
        )
        const notamVolumeIds = getRenderedFeatureIds(
          renderedFeatures.filter((feature) => feature.source === notamVolumeSourceId),
        )
        const notamLineIds = getRenderedFeatureIds(
          renderedFeatures.filter((feature) => feature.source === notamLineSourceId),
        )
        const notamPointIds = getRenderedFeatureIds(
          renderedFeatures.filter((feature) => feature.source === notamPointSourceId),
        )

        setLayerIdFilter(map, airspaceBaseHighlightLayerId, airspaceIds)
        setLayerIdFilter(map, airspaceHighlightLayerId, airspaceIds)
        setLayerIdFilter(map, notamVolumeHighlightLayerId, notamVolumeIds)
        setLayerIdFilter(map, notamLineHighlightLayerId, notamLineIds)
        setLayerIdFilter(map, notamPointHighlightLayerId, notamPointIds)
      }
      const clearHoverHighlights = () => {
        setLayerIdFilter(map, airspaceBaseHighlightLayerId, [])
        setLayerIdFilter(map, airspaceHighlightLayerId, [])
        setLayerIdFilter(map, notamVolumeHighlightLayerId, [])
        setLayerIdFilter(map, notamLineHighlightLayerId, [])
        setLayerIdFilter(map, notamPointHighlightLayerId, [])
      }

      map.on('mousemove', updateHoverHighlights)
      map.on('mouseleave', clearHoverHighlights)

      map.on('click', (event) => {
        if (suppressNextMapClickRef.current) {
          suppressNextMapClickRef.current = false
          return
        }

        if (latestInspectRef.current.routeEditingEnabled) {
          latestInspectRef.current.onRoutePointAdd(event.lngLat.lat, event.lngLat.lng)
        } else {
          latestInspectRef.current.onInspectPoint(event.lngLat.lat, event.lngLat.lng)
        }
      })

      updateOrCreateGeoJsonSource(map, routeSourceId, latestMapData.routeProfile.route ?? emptyGeoJsonFeatureCollection())
      map.addLayer({
        id: routeCasingLayerId,
        type: 'line',
        source: routeSourceId,
        maxzoom: routeGateMinZoom,
        layout: {
          'line-elevation-reference': 'sea',
          'line-z-offset': [
            '+',
            [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
            routeVisualClearanceMeters,
          ],
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#101828',
          'line-width': 8,
          'line-opacity': 0.9,
          'line-occlusion-opacity': 1,
        },
      })
      map.addLayer({
        id: routeLayerId,
        type: 'line',
        source: routeSourceId,
        maxzoom: routeGateMinZoom,
        layout: {
          'line-elevation-reference': 'sea',
          'line-z-offset': [
            '+',
            [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
            routeVisualClearanceMeters,
          ],
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': routeAccentColor,
          'line-emissive-strength': 1,
          'line-width': 4,
          'line-occlusion-opacity': 1,
        },
      })
      const routeGateLayer = createRouteGateFrameLayer(latestMapData.routeProfile.gates)
      routeGateLayerRef.current = routeGateLayer
      map.addLayer(routeGateLayer)
      map.moveLayer(routeLayerId)
      map.moveLayer(routeCasingLayerId, routeLayerId)

      updateOrCreateGeoJsonSource(map, routeWaypointSourceId, latestMapData.routeWaypointGeoJson)
      const routeObjectsLayer = createRouteObjectsLayer(
        latestMapData.route3DObjects.waypoints,
        latestMapData.route3DObjects.directions,
        latestMapData.aloftWindObjects,
      )
      routeObjectsLayerRef.current = routeObjectsLayer
      map.addLayer(routeObjectsLayer)

      updateOrCreateGeoJsonSource(map, tocTodSourceId, latestMapData.routeProfile.markers)
      map.addLayer({
        id: tocTodLayerId,
        type: 'symbol',
        source: tocTodSourceId,
        layout: {
          'text-field': ['format', ['get', 'label'], { 'font-scale': 1.1 }, '\n', {}, ['concat', ['to-string', ['get', 'altitudeFt']], ' ft'], { 'font-scale': 0.78 }],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
          'text-offset': [0, -1.4],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.3,
        },
      })
      if (map.getLayer(routeGateFrameLayerId)) {
        map.moveLayer(routeGateFrameLayerId)
      }

      persistCamera()
      emitMapView()
    }
    map.on('style.load', installStyleLayers)
    window.setTimeout(() => {
      if (map.isStyleLoaded() && !map.getLayer(airspaceLayerId)) {
        installStyleLayers()
      }
    }, 0)

    return () => {
      if (viewRefreshFrameId != null) {
        window.cancelAnimationFrame(viewRefreshFrameId)
      }
      for (const timeoutId of viewRefreshTimeoutIds) {
        window.clearTimeout(timeoutId)
      }
      viewRefreshTimeoutIds.clear()
      resizeObserver?.disconnect()
      persistCamera()
      routeGateLayerRef.current = null
      routeObjectsLayerRef.current = null
      holdingPatternLayerRef.current = null
      obstacleVolumeLayerRef.current = null
      notamObstacleVolumeLayerRef.current = null
      map.off('idle', refreshObstacleTerrain)
      map.remove()
      mapRef.current = null
    }
  }, [initialViewport, mapStyle])

  useEffect(() => {
    if (!showObstacles || !mapboxObstacleView || mapboxObstacleView.zoom < obstacleVolumeMinZoom) {
      return
    }

    const controller = new AbortController()
    const paddedBounds = padMapboxBounds(mapboxObstacleView.bounds, 0.15)
    const timeoutId = window.setTimeout(() => {
      fetchSwedishObstacles(paddedBounds, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setMapboxObstacles(result.obstacles)
          }
        })
        .catch((error) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            return
          }

          setMapboxObstacles([])
        })
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [mapboxObstacleView, showObstacles])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, airspaceSourceId, airspaceGeoJson)
  }, [airspaceGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, notamVolumeSourceId, notamGeoJson.volumes)
    updateOrCreateGeoJsonSource(map, notamLineSourceId, notamGeoJson.lines)
    updateOrCreateGeoJsonSource(map, notamPointSourceId, notamGeoJson.points)
    updateOrCreateGeoJsonSource(map, notamObstacleSymbolSourceId, notamObstacleSymbolGeoJson)
  }, [notamGeoJson, notamObstacleSymbolGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, weatherAreaSourceId, weatherGeoJson.areas)
    updateOrCreateGeoJsonSource(map, weatherLineSourceId, weatherGeoJson.lines)
  }, [weatherGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, mapPointSourceId, mapPointGeoJson)
  }, [mapPointGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    holdingPatternLayerRef.current?.setHoldings(holdingPatternObjects)
  }, [holdingPatternObjects])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, obstacleVolumeSourceId, obstacleGeoJson)
    updateOrCreateGeoJsonSource(map, obstacleSymbolSourceId, obstacleSymbolGeoJson)
    obstacleVolumeLayerRef.current?.setObstacles(obstacleObjects)
  }, [obstacleGeoJson, obstacleObjects, obstacleSymbolGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    notamObstacleVolumeLayerRef.current?.setObstacles(notamObstacleObjects)
  }, [notamObstacleObjects])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, aloftWindSourceId, aloftWindGeoJson)
  }, [aloftWindGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, routeSourceId, routeProfile.route ?? emptyGeoJsonFeatureCollection())
    routeGateLayerRef.current?.setGates(routeProfile.gates)
    routeObjectsLayerRef.current?.setRouteObjects(route3DObjects.waypoints, route3DObjects.directions, aloftWindObjects)
    updateOrCreateGeoJsonSource(map, routeWaypointSourceId, routeWaypointGeoJson)
    updateOrCreateGeoJsonSource(map, tocTodSourceId, routeProfile.markers)
  }, [aloftWindObjects, route3DObjects, routeProfile, routeWaypointGeoJson])

  if (!mapboxAccessToken) {
    return (
      <div className="fp-mapbox3d-empty">
        <strong>Mapbox-token saknas</strong>
        <span>Sätt VITE_MAPBOX_ACCESS_TOKEN i .env och starta om dev-servern för att visa 3D Mapbox (Beta).</span>
      </div>
    )
  }

  return (
    <>
      <div className="fp-mapbox3d-canvas" ref={containerRef} />
      <div className={`fp-mapbox3d-badge fp-mapbox3d-badge--${terrainDiagnostic.status}`}>
        <strong>
          3D Mapbox Beta
          <span>{terrainDiagnostic.message}</span>
        </strong>
        {routeProfile.summary ? (
          <span>
            Cruise {Math.round(routeProfile.summary.cruiseAltitudeFt)} ft · TOC {routeProfile.summary.topOfClimbDistanceNm.toFixed(1)} NM · TOD {routeProfile.summary.topOfDescentDistanceNm.toFixed(1)} NM
          </span>
        ) : (
          <span>Lägg till ruttpunkter för 3D-färdlinje</span>
        )}
        {terrainDiagnostic.details ? <small>{terrainDiagnostic.details}</small> : null}
      </div>
    </>
  )
}
