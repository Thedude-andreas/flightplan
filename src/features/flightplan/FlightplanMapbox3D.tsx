import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import * as THREE from 'three'
import 'mapbox-gl/dist/mapbox-gl.css'

import { getSwedishVisualPointDisplayLabel, type SwedishAirspace, type SwedishAirport, type SwedishNavaid, type SwedishVisualPoint } from './aviationData'
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

type Obstacle3DObject = {
  id: string
  lat: number
  lon: number
  radiusMeters: number
  heightMeters: number
  color: string
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
const weatherAreaSourceId = 'flightplan-3d-weather-areas'
const weatherAreaLayerId = 'flightplan-3d-weather-areas'
const weatherLineSourceId = 'flightplan-3d-weather-lines'
const weatherLineLayerId = 'flightplan-3d-weather-lines'
const mapPointSourceId = 'flightplan-3d-map-points'
const mapPointLayerId = 'flightplan-3d-map-points'
const mapPointEntryExitLayerId = 'flightplan-3d-map-point-entry-exit'
const airportWeatherLabelLayerId = 'flightplan-3d-airport-weather-labels'
const mapPointLabelLayerId = 'flightplan-3d-map-point-labels'
const holdingPatternLayerId = 'flightplan-3d-holding-patterns'
const obstacleVolumeSourceId = 'flightplan-3d-obstacle-volumes'
const obstacleVolumeLayerId = 'flightplan-3d-obstacle-volumes'
const obstacleVolumeOutlineLayerId = 'flightplan-3d-obstacle-volumes-outline'
const obstacleVolumeRenderLayerId = 'flightplan-3d-obstacle-volumes-render'
const obstacleVolumeMinZoom = 8
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
const reportingPointColor = '#732184'
const reportingPointSymbolMinZoom = 8.5
const reportingPointLabelMinZoom = 9
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
    summary: {
      cruiseAltitudeFt,
      topOfClimbDistanceNm,
      topOfDescentDistanceNm,
    },
  }
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

function getObstacle3DColor(obstacle: SwedishObstacle) {
  if (obstacle.category === 'wind_turbine') {
    return '#0f766e'
  }

  if (obstacle.category === 'vegetation') {
    return '#65a30d'
  }

  if (obstacle.category === 'navaid') {
    return '#4338ca'
  }

  return '#ea580c'
}

function getObstacle3DRadiusMeters(obstacle: SwedishObstacle) {
  if (obstacle.category === 'wind_turbine') {
    return 34
  }

  if (obstacle.category === 'building') {
    return 24
  }

  if (obstacle.category === 'vegetation') {
    return 20
  }

  return 14
}

function obstacleFootprintCoordinates(lat: number, lon: number, radiusMeters: number) {
  const radiusNm = radiusMeters / metersPerNm
  const points = Array.from({ length: 12 }, (_, index) => destinationPoint(lat, lon, (index / 12) * 360, radiusNm))
  points.push(points[0])
  return [points]
}

type RouteGateCustomLayer = mapboxgl.CustomLayerInterface & {
  setGates: (gates: RouteGateFrame[]) => void
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

function createObstacleVolumeLayer(initialObstacles: Obstacle3DObject[]): ObstacleVolumeCustomLayer {
  let map: mapboxgl.Map | null = null
  let camera: THREE.Camera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let obstacles = initialObstacles
  const materials = new Map<string, THREE.MeshBasicMaterial>()

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
      addObstacleCylinderMesh(map, scene, obstacle, getMaterial(obstacle.color))
    }
  }

  return {
    id: obstacleVolumeRenderLayerId,
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
      renderer?.dispose()
      map = null
      camera = null
      renderer = null
      scene = null
    },
    render(_gl, matrix) {
      if (!map || !camera || !renderer || !scene || map.getZoom() < obstacleVolumeMinZoom) {
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

function addObstacleCylinderMesh(
  map: mapboxgl.Map,
  scene: THREE.Scene,
  obstacle: Obstacle3DObject,
  material: THREE.Material,
) {
  const heightMeters = Math.max(12, obstacle.heightMeters)
  const terrainElevationMeters = map.queryTerrainElevation(
    { lng: obstacle.lon, lat: obstacle.lat },
    { exaggerated: false },
  ) ?? 0
  const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
    { lng: obstacle.lon, lat: obstacle.lat },
    terrainElevationMeters + heightMeters / 2,
  )
  const scale = coordinate.meterInMercatorCoordinateUnits()
  const geometry = new THREE.CylinderGeometry(
    obstacle.radiusMeters * scale,
    obstacle.radiusMeters * scale,
    heightMeters * scale,
    14,
  )
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(coordinate.x, coordinate.y, coordinate.z)
  mesh.rotation.x = Math.PI / 2
  scene.add(mesh)
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
        coordinates: obstacleFootprintCoordinates(obstacle.lat, obstacle.lon, getObstacle3DRadiusMeters(obstacle)),
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
    radiusMeters: getObstacle3DRadiusMeters(obstacle),
    heightMeters: Math.max(12, obstacleUnitToMeters(obstacle.heightValue, obstacle.heightUnit) ?? 60),
    color: getObstacle3DColor(obstacle),
  })) satisfies Obstacle3DObject[]
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
  showObstacles,
  onMapViewChange,
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
  showObstacles: boolean
  onMapViewChange?: (view: FlightplanMapboxView) => void
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
  const routeGateLayerRef = useRef<RouteGateCustomLayer | null>(null)
  const holdingPatternLayerRef = useRef<HoldingPatternCustomLayer | null>(null)
  const obstacleVolumeLayerRef = useRef<ObstacleVolumeCustomLayer | null>(null)
  const terrainErrorCountRef = useRef(0)
  const hasAppliedInitialViewportRef = useRef(false)
  const suppressNextMapClickRef = useRef(false)
  const [terrainDiagnostic, setTerrainDiagnostic] = useState<TerrainDiagnostic>(getInitialTerrainDiagnostic)
  const [mapboxObstacleView, setMapboxObstacleView] = useState<FlightplanMapboxObstacleView | null>(null)
  const [mapboxObstacles, setMapboxObstacles] = useState<SwedishObstacle[]>([])
  const routeProfile = useMemo(() => buildRouteProfile(plan, derived), [derived, plan])
  const airspaceGeoJson = useMemo(() => buildAirspaceGeoJson(airspaces), [airspaces])
  const notamGeoJson = useMemo(() => buildNotam3DGeoJson(notamFeatures), [notamFeatures])
  const weatherGeoJson = useMemo(() => buildWeather3DGeoJson(weatherOverlays), [weatherOverlays])
  const mapPointGeoJson = useMemo(
    () => buildMapPointGeoJson({ airportFlightCategories, airports, navaids, visualPoints }),
    [airportFlightCategories, airports, navaids, visualPoints],
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
  const latestViewChangeRef = useRef(onMapViewChange)
  const latestMapDataRef = useRef({
    airspaceGeoJson,
    aloftWindGeoJson,
    holdingPatternObjects,
    mapPointGeoJson,
    notamGeoJson,
    obstacleGeoJson,
    obstacleObjects,
    plan,
    routeProfile,
    weatherGeoJson,
  })

  useEffect(() => {
    latestViewChangeRef.current = onMapViewChange
  }, [onMapViewChange])

  useEffect(() => {
    latestMapDataRef.current = {
      airspaceGeoJson,
      aloftWindGeoJson,
      holdingPatternObjects,
      mapPointGeoJson,
      notamGeoJson,
      obstacleGeoJson,
      obstacleObjects,
      plan,
      routeProfile,
      weatherGeoJson,
    }
  }, [airspaceGeoJson, aloftWindGeoJson, holdingPatternObjects, mapPointGeoJson, notamGeoJson, obstacleGeoJson, obstacleObjects, plan, routeProfile, weatherGeoJson])

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

    const installStyleLayers = () => {
      if (map.getLayer(airspaceLayerId)) {
        updateOrCreateGeoJsonSource(map, obstacleVolumeSourceId, latestMapDataRef.current.obstacleGeoJson)
        obstacleVolumeLayerRef.current?.setObstacles(latestMapDataRef.current.obstacleObjects)
        refreshMapView()
        return
      }

      obstacleVolumeLayerRef.current = null
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
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
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

      updateOrCreateGeoJsonSource(map, obstacleVolumeSourceId, latestMapData.obstacleGeoJson)
      map.addLayer({
        id: obstacleVolumeLayerId,
        type: 'fill',
        source: obstacleVolumeSourceId,
        slot: 'top',
        minzoom: obstacleVolumeMinZoom,
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
        minzoom: obstacleVolumeMinZoom,
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

      updateOrCreateGeoJsonSource(map, mapPointSourceId, latestMapData.mapPointGeoJson)
      map.addLayer({
        id: mapPointLayerId,
        type: 'circle',
        source: mapPointSourceId,
        filter: ['!=', ['get', 'category'], 'visual-point'],
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
          'text-color': ['case', ['all', ['==', ['get', 'category'], 'visual-point'], ['==', ['get', 'kind'], 'entry-exit']], reportingPointColor, '#0f172a'],
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
        weatherAreaLayerId,
        weatherLineLayerId,
        obstacleVolumeLayerId,
        mapPointLayerId,
        mapPointEntryExitLayerId,
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
          const isMapPointInteraction = layerId === mapPointLayerId || layerId === mapPointEntryExitLayerId || layerId === airportWeatherLabelLayerId || layerId === mapPointLabelLayerId

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

        latestInspectRef.current.onInspectPoint(event.lngLat.lat, event.lngLat.lng)
      })

      if (latestMapData.routeProfile.route) {
        updateOrCreateGeoJsonSource(map, routeSourceId, latestMapData.routeProfile.route)
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
      holdingPatternLayerRef.current = null
      obstacleVolumeLayerRef.current = null
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

    holdingPatternLayerRef.current?.setHoldings(holdingPatternObjects)
  }, [holdingPatternObjects])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) {
      return
    }

    updateOrCreateGeoJsonSource(map, obstacleVolumeSourceId, obstacleGeoJson)
    obstacleVolumeLayerRef.current?.setObstacles(obstacleObjects)
  }, [obstacleGeoJson, obstacleObjects])

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
      routeGateLayerRef.current?.setGates(routeProfile.gates)
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
