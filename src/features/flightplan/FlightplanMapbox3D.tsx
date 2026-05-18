import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

import type { SwedishAirspace } from './aviationData'
import type { FlightPlanDerived, FlightPlanInput } from './types'

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

const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim() ?? ''
const terrainSourceId = 'mapbox-dem'
const routeSourceId = 'flightplan-3d-route'
const routeLayerId = 'flightplan-3d-route-line'
const routeCasingLayerId = 'flightplan-3d-route-casing'
const airspaceSourceId = 'flightplan-3d-airspaces'
const airspaceLayerId = 'flightplan-3d-airspaces'
const airspaceOutlineLayerId = 'flightplan-3d-airspaces-outline'
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
const terrainDemoCenter: [number, number] = [13.08, 63.4]
const feetToMeters = 0.3048
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

function fitRoute(map: mapboxgl.Map, plan: FlightPlanInput) {
  const routeCoordinates = plan.routeLegs.flatMap((leg, index) => (
    index === 0
      ? [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]]
      : [[leg.to.lon, leg.to.lat]]
  ))

  if (routeCoordinates.length === 0) {
    map.easeTo({
      center: terrainDemoCenter,
      zoom: 11.5,
      pitch: 80,
      bearing: 42,
      duration: 0,
    })
    return
  }

  const bounds = routeCoordinates.reduce(
    (currentBounds, coordinate) => currentBounds.extend(coordinate as [number, number]),
    new mapboxgl.LngLatBounds(routeCoordinates[0] as [number, number], routeCoordinates[0] as [number, number]),
  )

  map.fitBounds(bounds, {
    padding: 90,
    pitch: 68,
    bearing: -18,
    duration: 0,
  })
}

export function FlightplanMapbox3D({
  airspaces,
  mapStyle,
  plan,
  derived,
}: {
  airspaces: SwedishAirspace[]
  mapStyle: FlightplanMapbox3DStyle
  plan: FlightPlanInput
  derived: FlightPlanDerived
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const terrainErrorCountRef = useRef(0)
  const [terrainDiagnostic, setTerrainDiagnostic] = useState<TerrainDiagnostic>(getInitialTerrainDiagnostic)
  const routeProfile = useMemo(() => buildRouteProfile(plan, derived), [derived, plan])
  const airspaceGeoJson = useMemo(() => buildAirspaceGeoJson(airspaces), [airspaces])
  const latestMapDataRef = useRef({ airspaceGeoJson, plan, routeProfile })

  useEffect(() => {
    latestMapDataRef.current = { airspaceGeoJson, plan, routeProfile }
  }, [airspaceGeoJson, plan, routeProfile])

  useEffect(() => {
    if (!containerRef.current || !mapboxAccessToken || mapRef.current) {
      return
    }

    mapboxgl.accessToken = mapboxAccessToken
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapboxStyleUrls[mapStyle],
      projection: 'mercator',
      center: terrainDemoCenter,
      zoom: 11.5,
      pitch: 80,
      bearing: 42,
      antialias: true,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')

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
          'fill-extrusion-opacity': 0.18,
          'fill-extrusion-vertical-gradient': false,
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
          'line-width': 1.3,
          'line-opacity': 0.8,
        },
      })

      if (latestMapData.routeProfile.route) {
        updateOrCreateGeoJsonSource(map, routeSourceId, latestMapData.routeProfile.route)
        map.addLayer({
          id: routeCasingLayerId,
          type: 'line',
          source: routeSourceId,
          layout: {
            'line-elevation-reference': 'sea',
            'line-z-offset': [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#101828',
            'line-width': 8,
            'line-opacity': 0.9,
          },
        })
        map.addLayer({
          id: routeLayerId,
          type: 'line',
          source: routeSourceId,
          layout: {
            'line-elevation-reference': 'sea',
            'line-z-offset': [
              'at-interpolated',
              ['*', ['line-progress'], ['-', ['length', ['get', 'elevation']], 1]],
              ['get', 'elevation'],
            ],
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#00d1ff',
            'line-emissive-strength': 1,
            'line-width': 4,
          },
        })
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

      fitRoute(map, latestMapData.plan)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [mapStyle])

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

    if (routeProfile.route) {
      updateOrCreateGeoJsonSource(map, routeSourceId, routeProfile.route)
      updateOrCreateGeoJsonSource(map, tocTodSourceId, routeProfile.markers)
      fitRoute(map, plan)
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
