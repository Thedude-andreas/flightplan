import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

import type { SwedishAirspace, SwedishAirport, SwedishNavaid, SwedishVisualPoint } from './aviationData'
import type { NotamMapOverlayFeature } from './notamRoute'
import type { RouteLegAloftWind } from './openMeteoAloft'
import type { FlightPlanDerived, FlightPlanInput } from './types'
import type { RouteWeatherOverlay } from './weatherSigmet'

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

const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim() ?? ''
const mapboxCameraStorageKey = 'flightplan-mapbox-3d-camera'
const terrainSourceId = 'mapbox-dem'
const routeSourceId = 'flightplan-3d-route'
const routeLayerId = 'flightplan-3d-route-line'
const routeCasingLayerId = 'flightplan-3d-route-casing'
const routeGateFrameSourceId = 'flightplan-3d-route-gate-frame'
const routeGateFrameLayerId = 'flightplan-3d-route-gate-frame'
const airspaceSourceId = 'flightplan-3d-airspaces'
const airspaceLayerId = 'flightplan-3d-airspaces'
const airspaceOutlineLayerId = 'flightplan-3d-airspaces-outline'
const airspaceBaseOutlineLayerId = 'flightplan-3d-airspaces-base-outline'
const notamVolumeSourceId = 'flightplan-3d-notam-volumes'
const notamVolumeLayerId = 'flightplan-3d-notam-volumes'
const notamVolumeOutlineLayerId = 'flightplan-3d-notam-volumes-outline'
const notamLineSourceId = 'flightplan-3d-notam-lines'
const notamLineLayerId = 'flightplan-3d-notam-lines'
const notamPointSourceId = 'flightplan-3d-notam-points'
const notamPointLayerId = 'flightplan-3d-notam-points'
const weatherAreaSourceId = 'flightplan-3d-weather-areas'
const weatherAreaLayerId = 'flightplan-3d-weather-areas'
const weatherLineSourceId = 'flightplan-3d-weather-lines'
const weatherLineLayerId = 'flightplan-3d-weather-lines'
const mapPointSourceId = 'flightplan-3d-map-points'
const mapPointLayerId = 'flightplan-3d-map-points'
const airportWeatherLabelLayerId = 'flightplan-3d-airport-weather-labels'
const mapPointLabelLayerId = 'flightplan-3d-map-point-labels'
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
const airspaceFillOpacity = 0.18
const routeAccentColor = '#ff35c4'
const routeGateMinZoom = 10.4
const routeVisualClearanceMeters = 70
const routeGateHalfWidthNm = 0.11
const routeGateHalfHeightMeters = 140
const routeGatePostHalfSizeNm = 0.0018
const routeGateRailHalfHeightMeters = 3
const notamVolumeBaseFt = 0
const notamVolumeDefaultUpperFt = 5000
const mapboxStyleUrls: Record<FlightplanMapbox3DStyle, string> = {
  ortho: 'mapbox://styles/mapbox/standard-satellite',
  topo: 'mapbox://styles/mapbox/outdoors-v12',
  standard: 'mapbox://styles/mapbox/standard',
  light: 'mapbox://styles/mapbox/light-v11',
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

function formatAirspacePopup(properties: mapboxgl.GeoJSONFeature['properties']) {
  const kind = String(properties?.kind ?? 'Luftrum')
  const name = String(properties?.name ?? '')
  const lower = String(properties?.lower ?? '-')
  const upper = String(properties?.upper ?? '-')

  return `
    <div class="fp-mapbox3d-popup">
      <strong>${escapeHtml(kind)}${name ? ` · ${escapeHtml(name)}` : ''}</strong>
      <span>${escapeHtml(lower)} till ${escapeHtml(upper)}</span>
    </div>
  `
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
      gates: {
        type: 'FeatureCollection',
        features: [],
      } satisfies GeoJsonFeatureCollection,
      markers: {
        type: 'FeatureCollection',
        features: [],
      } satisfies GeoJsonFeatureCollection,
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

  const profilePoints: RouteProfilePoint[] = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const distanceNm = (totalDistanceNm * index) / sampleCount
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
  const gateFrameFeatures: GeoJsonFeature[] = []

  for (const [index, distanceNm] of gateDistances.entries()) {
    const pointIndex = profilePoints.findIndex((point) => point.distanceNm >= distanceNm)
    const nextPoint = profilePoints[Math.max(1, pointIndex === -1 ? profilePoints.length - 1 : pointIndex)]
    const previousPoint = profilePoints[Math.max(0, profilePoints.indexOf(nextPoint) - 1)]
    const position = interpolateRoutePosition(plan, derived, distanceNm) ?? nextPoint
    const bearingDeg = initialBearingDegrees(previousPoint.lat, previousPoint.lon, nextPoint.lat, nextPoint.lon)
    const gateBearingDeg = bearingDeg + 90
    const left = destinationPoint(position.lat, position.lon, gateBearingDeg - 180, routeGateHalfWidthNm)
    const right = destinationPoint(position.lat, position.lon, gateBearingDeg, routeGateHalfWidthNm)
    const altitudeFt = profilePoints.reduce((closest, point) => (
      Math.abs(point.distanceNm - distanceNm) < Math.abs(closest.distanceNm - distanceNm) ? point : closest
    ), profilePoints[0]).altitudeFt
    const centerElevationMeters = altitudeFt * feetToMeters + routeVisualClearanceMeters
    const baseMeters = Math.max(0, centerElevationMeters - routeGateHalfHeightMeters)
    const heightMeters = centerElevationMeters + routeGateHalfHeightMeters

    gateFrameFeatures.push({
      type: 'Feature',
      properties: {
        id: `route-gate-${index}-bottom`,
        baseMeters: Math.max(0, baseMeters - routeGateRailHalfHeightMeters),
        heightMeters: baseMeters + routeGateRailHalfHeightMeters,
      },
      geometry: {
        type: 'Polygon',
        coordinates: alignedRailPolygonCoordinates(left, right, bearingDeg),
      },
    })
    gateFrameFeatures.push({
      type: 'Feature',
      properties: {
        id: `route-gate-${index}-top`,
        baseMeters: heightMeters - routeGateRailHalfHeightMeters,
        heightMeters: heightMeters + routeGateRailHalfHeightMeters,
      },
      geometry: {
        type: 'Polygon',
        coordinates: alignedRailPolygonCoordinates(left, right, bearingDeg),
      },
    })

    for (const [side, point] of [['left', left], ['right', right]] as const) {
      gateFrameFeatures.push({
        type: 'Feature',
        properties: {
          id: `route-gate-${index}-${side}`,
          baseMeters: Math.max(0, baseMeters - routeGateRailHalfHeightMeters),
          heightMeters: heightMeters + routeGateRailHalfHeightMeters,
        },
        geometry: {
          type: 'Polygon',
          coordinates: alignedPostPolygonCoordinates(point[1], point[0], bearingDeg, gateBearingDeg),
        },
      })
    }
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
    gates: {
      type: 'FeatureCollection',
      features: gateFrameFeatures,
    } satisfies GeoJsonFeatureCollection,
    markers: {
      type: 'FeatureCollection',
      features: markers,
    } satisfies GeoJsonFeatureCollection,
    summary: {
      cruiseAltitudeFt,
      topOfClimbDistanceNm,
      topOfDescentDistanceNm,
    },
  }
}

function getAirspaceColor(kind: SwedishAirspace['kind']) {
  const colors: Record<SwedishAirspace['kind'], string> = {
    CTR: '#ff9f43',
    TMA: '#4dabf7',
    TIA: '#38d9a9',
    TIZ: '#69db7c',
    R: '#ff6b6b',
    D: '#ffa94d',
    ATZ: '#51cf66',
    TRA: '#da77f2',
  }

  return colors[kind] ?? '#4dabf7'
}

function buildAirspaceGeoJson(airspaces: SwedishAirspace[]) {
  const features: GeoJsonFeature[] = []

  for (const airspace of airspaces) {
    const lowerFt = parseAltitudeFt(airspace.lower, 0) ?? 0
    const upperFt = parseAltitudeFt(airspace.upper, null)
    if (upperFt == null || upperFt <= lowerFt) {
      continue
    }

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
        color: getAirspaceColor(airspace.kind),
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

function alignedPostPolygonCoordinates(
  lat: number,
  lon: number,
  routeBearingDeg: number,
  gateBearingDeg: number,
) {
  const frontCenter = destinationPoint(lat, lon, routeBearingDeg, routeGatePostHalfSizeNm)
  const backCenter = destinationPoint(lat, lon, routeBearingDeg + 180, routeGatePostHalfSizeNm)
  const frontLeft = destinationPoint(frontCenter[1], frontCenter[0], gateBearingDeg - 180, routeGatePostHalfSizeNm)
  const frontRight = destinationPoint(frontCenter[1], frontCenter[0], gateBearingDeg, routeGatePostHalfSizeNm)
  const backRight = destinationPoint(backCenter[1], backCenter[0], gateBearingDeg, routeGatePostHalfSizeNm)
  const backLeft = destinationPoint(backCenter[1], backCenter[0], gateBearingDeg - 180, routeGatePostHalfSizeNm)

  return [[frontLeft, frontRight, backRight, backLeft, frontLeft]]
}

function alignedRailPolygonCoordinates(
  left: [number, number],
  right: [number, number],
  routeBearingDeg: number,
) {
  const frontLeft = destinationPoint(left[1], left[0], routeBearingDeg, routeGatePostHalfSizeNm)
  const frontRight = destinationPoint(right[1], right[0], routeBearingDeg, routeGatePostHalfSizeNm)
  const backRight = destinationPoint(right[1], right[0], routeBearingDeg + 180, routeGatePostHalfSizeNm)
  const backLeft = destinationPoint(left[1], left[0], routeBearingDeg + 180, routeGatePostHalfSizeNm)

  return [[frontLeft, frontRight, backRight, backLeft, frontLeft]]
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
      properties: { id: feature.id, title, body: feature.source, color, category: 'notam' },
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

function buildMapPointGeoJson({
  airportFlightCategories,
  airports,
  navaids,
  visualPoints,
}: {
  airportFlightCategories: Record<string, FlightplanMapboxAirportFlightCategory>
  airports: SwedishAirport[]
  navaids: SwedishNavaid[]
  visualPoints: SwedishVisualPoint[]
}) {
  const features: GeoJsonFeature[] = [
    ...airports.map((airport) => ({
      type: 'Feature' as const,
      properties: (() => {
        const flightCategory = airport.icao ? airportFlightCategories[airport.icao] ?? 'UNKNOWN' : 'UNKNOWN'
        return {
          category: 'airport',
          id: airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`,
          label: airport.icao ?? airport.name ?? 'AD',
          title: airport.icao ?? airport.name ?? 'Flygplats',
          body: airport.name ?? '',
          color: flightCategory === 'VMC'
            ? '#16803c'
            : flightCategory === 'MVMC'
              ? '#b45309'
              : flightCategory === 'IMC'
                ? '#b91c1c'
                : '#64748b',
          radius: flightCategory === 'UNKNOWN' ? 5 : 9,
          sortPriority: flightCategory === 'UNKNOWN' ? 30 : 60,
          flightCategory,
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
        color: '#7c3aed',
        radius: 4,
        sortPriority: 10,
      },
      geometry: { type: 'Point', coordinates: [navaid.lon, navaid.lat] },
    })),
    ...visualPoints.map((point) => ({
      type: 'Feature' as const,
      properties: {
        category: 'visual-point',
        id: point.id,
        label: point.name ?? point.positionIndicator ?? 'VFR',
        title: point.name ?? point.positionIndicator ?? 'VFR-punkt',
        body: point.kind,
        color: point.kind === 'holding' ? '#059669' : '#f97316',
        radius: 4,
        sortPriority: 20,
      },
      geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    })),
  ]

  return { type: 'FeatureCollection', features } satisfies GeoJsonFeatureCollection
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
  onInspectAirport,
  onInspectNavaid,
  onInspectNotamFeature,
  onInspectPoint,
  onInspectVisualPoint,
  plan,
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
  onInspectAirport: (airport: SwedishAirport) => void
  onInspectNavaid: (navaid: SwedishNavaid) => void
  onInspectNotamFeature: (feature: NotamMapOverlayFeature, lat: number, lon: number) => void
  onInspectPoint: (lat: number, lon: number) => void
  onInspectVisualPoint: (point: SwedishVisualPoint) => void
  plan: FlightPlanInput
  derived: FlightPlanDerived
  visualPoints: SwedishVisualPoint[]
  weatherOverlays: RouteWeatherOverlay[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const terrainErrorCountRef = useRef(0)
  const hasAppliedInitialViewportRef = useRef(false)
  const suppressNextMapClickRef = useRef(false)
  const [terrainDiagnostic, setTerrainDiagnostic] = useState<TerrainDiagnostic>(getInitialTerrainDiagnostic)
  const routeProfile = useMemo(() => buildRouteProfile(plan, derived), [derived, plan])
  const airspaceGeoJson = useMemo(() => buildAirspaceGeoJson(airspaces), [airspaces])
  const notamGeoJson = useMemo(() => buildNotam3DGeoJson(notamFeatures), [notamFeatures])
  const weatherGeoJson = useMemo(() => buildWeather3DGeoJson(weatherOverlays), [weatherOverlays])
  const mapPointGeoJson = useMemo(
    () => buildMapPointGeoJson({ airportFlightCategories, airports, navaids, visualPoints }),
    [airportFlightCategories, airports, navaids, visualPoints],
  )
  const aloftWindGeoJson = useMemo(() => buildAloftWindGeoJson(aloftWinds), [aloftWinds])
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
    visualPointById,
  })
  const latestMapDataRef = useRef({
    airspaceGeoJson,
    aloftWindGeoJson,
    mapPointGeoJson,
    notamGeoJson,
    plan,
    routeProfile,
    weatherGeoJson,
  })

  useEffect(() => {
    latestMapDataRef.current = {
      airspaceGeoJson,
      aloftWindGeoJson,
      mapPointGeoJson,
      notamGeoJson,
      plan,
      routeProfile,
      weatherGeoJson,
    }
  }, [airspaceGeoJson, aloftWindGeoJson, mapPointGeoJson, notamGeoJson, plan, routeProfile, weatherGeoJson])

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
    const persistCamera = () => writeStoredMapboxCamera(getMapCamera(map))
    map.on('moveend', persistCamera)
    map.on('zoomend', persistCamera)
    map.on('pitchend', persistCamera)
    map.on('rotateend', persistCamera)

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

    map.on('style.load', () => {
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

      updateOrCreateGeoJsonSource(map, airspaceSourceId, latestMapData.airspaceGeoJson)
      map.addLayer({
        id: airspaceLayerId,
        type: 'fill-extrusion',
        source: airspaceSourceId,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-base': ['get', 'baseMeters'],
          'fill-extrusion-height': ['get', 'heightMeters'],
          'fill-extrusion-opacity': airspaceFillOpacity,
          'fill-extrusion-vertical-gradient': false,
        },
      })
      map.addLayer({
        id: airspaceBaseOutlineLayerId,
        type: 'line',
        source: airspaceSourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.1, 10, 1.8, 14, 3.2],
          'line-opacity': 0.72,
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
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 2.2, 14, 3.8],
          'line-opacity': 0.95,
        },
      })
      const airspacePopup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
      })
      map.on('mouseenter', airspaceLayerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mousemove', airspaceLayerId, (event) => {
        const feature = event.features?.[0]
        if (!feature) {
          return
        }

        airspacePopup
          .setLngLat(event.lngLat)
          .setHTML(formatAirspacePopup(feature.properties))
          .addTo(map)
      })
      map.on('mouseleave', airspaceLayerId, () => {
        map.getCanvas().style.cursor = ''
        airspacePopup.remove()
      })
      map.on('click', airspaceLayerId, (event) => {
        const feature = event.features?.[0]
        if (!feature) {
          return
        }

        suppressNextMapClickRef.current = true
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
          'fill-extrusion-opacity': 0.22,
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
      updateOrCreateGeoJsonSource(map, notamPointSourceId, latestMapData.notamGeoJson.points)
      map.addLayer({
        id: notamPointLayerId,
        type: 'circle',
        source: notamPointSourceId,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 8],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      })

      updateOrCreateGeoJsonSource(map, weatherAreaSourceId, latestMapData.weatherGeoJson.areas)
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

      updateOrCreateGeoJsonSource(map, mapPointSourceId, latestMapData.mapPointGeoJson)
      map.addLayer({
        id: mapPointLayerId,
        type: 'circle',
        source: mapPointSourceId,
        layout: {
          'circle-sort-key': ['get', 'sortPriority'],
        },
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['get', 'radius'], 12, ['*', ['get', 'radius'], 1.8]],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 12, 2.3],
          'circle-opacity': 0.95,
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
          'symbol-sort-key': ['get', 'sortPriority'],
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
        minzoom: 8,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 13],
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      })

      updateOrCreateGeoJsonSource(map, aloftWindSourceId, latestMapData.aloftWindGeoJson)
      map.addLayer({
        id: aloftWindLayerId,
        type: 'symbol',
        source: aloftWindSourceId,
        layout: {
          'text-field': '>',
          'text-size': 18,
          'text-rotate': ['get', 'direction'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      })

      const genericPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
      const popupLayers = [
        notamVolumeLayerId,
        notamLineLayerId,
        notamPointLayerId,
        weatherAreaLayerId,
        weatherLineLayerId,
        mapPointLayerId,
        airportWeatherLabelLayerId,
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
          const isMapPointInteraction = layerId === mapPointLayerId || layerId === airportWeatherLabelLayerId

          if (isMapPointInteraction && category === 'airport') {
            const airport = latestInspect.airportById.get(id)
            if (airport) {
              latestInspect.onInspectAirport(airport)
              return
            }
          }

          if (isMapPointInteraction && category === 'navaid') {
            const navaid = latestInspect.navaidById.get(id)
            if (navaid) {
              latestInspect.onInspectNavaid(navaid)
              return
            }
          }

          if (isMapPointInteraction && category === 'visual-point') {
            const visualPoint = latestInspect.visualPointById.get(id)
            if (visualPoint) {
              latestInspect.onInspectVisualPoint(visualPoint)
              return
            }
          }

          if (layerId === notamVolumeLayerId || layerId === notamLineLayerId || layerId === notamPointLayerId) {
            const notamFeature = latestInspect.notamFeatureById.get(id)
            if (notamFeature) {
              latestInspect.onInspectNotamFeature(notamFeature, event.lngLat.lat, event.lngLat.lng)
              return
            }
          }

          new mapboxgl.Popup({ offset: 14 }).setLngLat(event.lngLat).setHTML(formatGenericPopup(properties)).addTo(map)
        })
      }

      map.on('click', (event) => {
        if (suppressNextMapClickRef.current) {
          suppressNextMapClickRef.current = false
          return
        }

        latestInspectRef.current.onInspectPoint(event.lngLat.lat, event.lngLat.lng)
      })

      if (latestMapData.routeProfile.route) {
        updateOrCreateGeoJsonSource(map, routeSourceId, latestMapData.routeProfile.route)
        updateOrCreateGeoJsonSource(map, routeGateFrameSourceId, latestMapData.routeProfile.gates)
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
        map.addLayer({
          id: routeGateFrameLayerId,
          type: 'fill-extrusion',
          source: routeGateFrameSourceId,
          minzoom: routeGateMinZoom,
          paint: {
            'fill-extrusion-color': routeAccentColor,
            'fill-extrusion-base': ['get', 'baseMeters'],
            'fill-extrusion-height': ['get', 'heightMeters'],
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': false,
          },
        })
        map.moveLayer(routeGateFrameLayerId)
        map.moveLayer(routeLayerId)
        map.moveLayer(routeCasingLayerId, routeLayerId)
      }

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

      persistCamera()
    })

    return () => {
      persistCamera()
      map.remove()
      mapRef.current = null
    }
  }, [initialViewport, mapStyle])

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
  }, [notamGeoJson])

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

    updateOrCreateGeoJsonSource(map, aloftWindSourceId, aloftWindGeoJson)
  }, [aloftWindGeoJson])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    if (routeProfile.route) {
      updateOrCreateGeoJsonSource(map, routeSourceId, routeProfile.route)
      updateOrCreateGeoJsonSource(map, routeGateFrameSourceId, routeProfile.gates)
      updateOrCreateGeoJsonSource(map, tocTodSourceId, routeProfile.markers)
    }
  }, [plan, routeProfile])

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
