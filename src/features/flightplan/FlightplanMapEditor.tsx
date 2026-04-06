import { useEffect, useMemo, useRef, useState } from 'react'
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
  useMapEvents,
  useMap,
} from 'react-leaflet'
import L, { divIcon, type LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'

import {
  getSwedishAirports,
  getSwedishAirspaces,
  getSwedishNavaids,
  type SwedishAirport,
  type SwedishAirspace,
  type SwedishAirspaceGeometry,
  type SwedishNavaid,
} from './aviationData'
import { calculateFlightPlan, formatTimeFromMinutes } from './calculations'
import { formatCoordinateDms } from './coordinates'
import { getRoutePointLabel, legsToWaypoints, pointWithNearestName, waypointsToLegs } from './gazetteer'
import {
  classifyMetarFlightRules,
  fetchMetarsForAirports,
  type AirportMetar,
  type MetarFlightCategory,
  type NearbyAirport,
} from './weather'
import { getAllWeatherOverlays, type RouteWeatherOverlay } from './weatherSigmet'
import type { FlightPlanInput, FlightPlanDerived } from './types'

type BasemapKey = 'topo' | 'osm'

const basemaps: Record<
  BasemapKey,
  { label: string; url: string; attribution: string }
> = {
  topo: {
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
  osm: {
    label: 'OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
}

const waypointIcon = divIcon({
  className: 'fp-waypoint-icon',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function createAirportIcon(category: MetarFlightCategory) {
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
    className: 'fp-airport-marker',
    html: `<span class="${variant}">${label}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

function createMapLabelIcon(className: string, label: string) {
  return divIcon({
    className,
    html: `<span>${label}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

const routeLineWeight = 6
const airportLabelMinZoom = 8
const airportMarkerRadiusPx = 4
const navaidMinZoom = 7
const navaidLabelMinZoom = 9
const directionArrowWaypointClearancePx = 22
const maxVisibleAirspaceLowerFt = 9500
const sigmetOverlayPalette = {
  color: '#a61e4d',
  fillColor: '#f05d88',
  lineColor: '#b44300',
  lineFill: '#ffd0a6',
} as const

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

function isPlaceholderLeg(legs: FlightPlanInput['routeLegs']) {
  if (legs.length !== 1) {
    return false
  }

  const [leg] = legs
  return leg.from.lat === leg.to.lat && leg.from.lon === leg.to.lon
}

function MapClickHandler({
  onAddPoint,
  shouldSuppressClick,
}: {
  onAddPoint: (lat: number, lon: number) => void
  shouldSuppressClick: () => boolean
}) {
  useMapEvents({
    click(event) {
      if (shouldSuppressClick()) {
        return
      }
      onAddPoint(event.latlng.lat, event.latlng.lng)
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
    onBoundsChange(map.getBounds())
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
}: {
  waypoints: FlightPlanInput['routeLegs'][number]['from'][]
  focusedLegIndex: number | null
  initialViewport: FlightplanMapViewport | null
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
      map.fitBounds(bounds.pad(0.3), {
        animate: false,
      })
    } else {
      map.setView(emptyPlanViewport.center, emptyPlanViewport.zoom, {
        animate: false,
      })
    }

    didApplyInitialViewport.current = true
  }, [focusedLegIndex, initialViewport, map, waypoints])

  return null
}

function MapInstanceHandler({
  onReady,
}: {
  onReady: (map: L.Map) => void
}) {
  const map = useMap()

  useEffect(() => {
    onReady(map)
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

export function FlightplanMapEditor({
  plan,
  derived,
  sigmetText = null,
  onRouteLegsChange,
  focusedLegIndex = null,
  initialViewport = null,
  onViewportChange,
}: {
  plan: FlightPlanInput
  derived: FlightPlanDerived
  sigmetText?: string | null
  onRouteLegsChange: (legs: FlightPlanInput['routeLegs']) => void
  focusedLegIndex?: number | null
  initialViewport?: FlightplanMapViewport | null
  onViewportChange?: (viewport: FlightplanMapViewport) => void
}) {
  const swedishAirspaces = getSwedishAirspaces()
  const swedishAirports = getSwedishAirports()
  const swedishNavaids = getSwedishNavaids()
  const [basemap, setBasemap] = useState<BasemapKey>('topo')
  const [showAirspaces, setShowAirspaces] = useState(true)
  const [mapZoom, setMapZoom] = useState(7)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null)
  const [dragPreviewWaypoints, setDragPreviewWaypoints] = useState<ReturnType<typeof legsToWaypoints> | null>(null)
  const [activeSegmentInsertIndex, setActiveSegmentInsertIndex] = useState<number | null>(null)
  const [waypointMarkerLayerVersion, setWaypointMarkerLayerVersion] = useState(0)
  const [airportMetarsByIcao, setAirportMetarsByIcao] = useState<Record<string, AirportMetar>>({})
  const suppressNextMapClick = useRef(false)
  const pendingAirportMetarsRef = useRef(new Set<string>())
  const hasPendingStartPoint = useMemo(() => isPlaceholderLeg(plan.routeLegs), [plan.routeLegs])
  const waypoints = useMemo(() => {
    if (hasPendingStartPoint) {
      return plan.routeLegs.length > 0 ? [plan.routeLegs[0].from] : []
    }

    return legsToWaypoints(plan.routeLegs)
  }, [hasPendingStartPoint, plan.routeLegs])
  const displayWaypoints = dragPreviewWaypoints ?? waypoints
  const previewRouteLegs = useMemo(
    () => (displayWaypoints.length < 2 ? [] : waypointsToLegs(displayWaypoints, plan.routeLegs, derived.aircraft.cruiseTasKt)),
    [derived.aircraft.cruiseTasKt, displayWaypoints, plan.routeLegs],
  )
  const previewDerived = useMemo(
    () => calculateFlightPlan({ ...plan, routeLegs: previewRouteLegs }, [derived.aircraft]),
    [derived.aircraft, plan, previewRouteLegs],
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
    [],
  )
  const visibleAirspaces = useMemo(
    () =>
      swedishAirspaces
        .filter((airspace) => {
          const lowerFeet = parseAirspaceAltitudeFeet(airspace.lower)
          return lowerFeet == null || lowerFeet < maxVisibleAirspaceLowerFt
        }),
    [],
  )
  const routeWeatherOverlays = useMemo<RouteWeatherOverlay[]>(
    () => getAllWeatherOverlays(sigmetText),
    [sigmetText],
  )
  const visibleWeatherAirports = useMemo<NearbyAirport[]>(() => {
    if (!mapBounds) {
      return []
    }

    const paddedBounds = mapBounds.pad(0.2)

    return swedishAirports
      .filter((airport): airport is SwedishAirport & { icao: string; name: string } => Boolean(airport.icao && airport.name))
      .filter((airport) => paddedBounds.contains([airport.lat, airport.lon]))
      .map((airport) => ({
        ...airport,
        distanceNm: 0,
      }))
  }, [mapBounds, swedishAirports])
  const visibleWeatherAirportKey = useMemo(
    () => visibleWeatherAirports.map((airport) => airport.icao).sort((left, right) => left.localeCompare(right, 'sv')).join(','),
    [visibleWeatherAirports],
  )

  useEffect(() => {
    if (visibleWeatherAirports.length === 0) {
      return
    }

    const airportsToFetch = visibleWeatherAirports.filter((airport) => {
      return !airportMetarsByIcao[airport.icao] && !pendingAirportMetarsRef.current.has(airport.icao)
    })

    if (airportsToFetch.length === 0) {
      return
    }

    const controller = new AbortController()
    for (const airport of airportsToFetch) {
      pendingAirportMetarsRef.current.add(airport.icao)
    }

    fetchMetarsForAirports(airportsToFetch, controller.signal)
      .then((results) => {
        setAirportMetarsByIcao((current) => {
          const next = { ...current }
          for (const result of results) {
            next[result.airport.icao] = result
          }
          return next
        })
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== 'AbortError') {
          console.error('Kunde inte hämta METAR för kartflygplatser.', error)
        }
      })
      .finally(() => {
        for (const airport of airportsToFetch) {
          pendingAirportMetarsRef.current.delete(airport.icao)
        }
      })

    return () => controller.abort()
  }, [airportMetarsByIcao, visibleWeatherAirportKey, visibleWeatherAirports])

  const setWaypoints = (nextWaypoints: typeof waypoints) => {
    setDragPreviewWaypoints(null)
    setActiveSegmentInsertIndex(null)
    const nextLegs = waypointsToLegs(nextWaypoints, plan.routeLegs, derived.aircraft.cruiseTasKt)
    onRouteLegsChange(nextLegs)
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
    const nextPoint = resolveRoutePoint(lat, lon)
    if (waypoints.length === 0) {
      onRouteLegsChange([
        {
          from: nextPoint,
          to: nextPoint,
          windDirection: 220,
          windSpeedKt: 15,
          tasKt: derived.aircraft.cruiseTasKt,
          variation: 6,
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
          windDirection: 220,
          windSpeedKt: 15,
          tasKt: derived.aircraft.cruiseTasKt,
          variation: 6,
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
    suppressNextMapClick.current = true
    setActiveSegmentInsertIndex(segmentIndex + 1)

    if (mapInstance) {
      mapInstance.dragging.disable()
    }

    previewInsertWaypointAt(segmentIndex + 1, lat, lon)
  }

  const updateSegmentInsertDrag = (lat: number, lon: number) => {
    if (activeSegmentInsertIndex == null) {
      return
    }

    setDragPreviewWaypoints((current) => {
      if (!current) {
        const next = [...waypoints]
        next.splice(activeSegmentInsertIndex, 0, resolveRoutePoint(lat, lon))
        return next
      }

      return current.map((point, pointIndex) =>
        pointIndex === activeSegmentInsertIndex ? resolveRoutePoint(lat, lon) : point,
      )
    })
  }

  const endSegmentInsertDrag = (lat: number, lon: number) => {
    if (activeSegmentInsertIndex == null) {
      return
    }

    if (mapInstance) {
      mapInstance.dragging.enable()
    }

    insertWaypointAt(activeSegmentInsertIndex, lat, lon)
  }

  const removeWaypoint = (index: number) => {
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
    <section className="fp-map-editor">
      <div className="fp-map-toolbar">
        <div className="fp-map-controls">
          <label className="fp-basemap-control">
            Kartlager
            <select value={basemap} onChange={(event) => setBasemap(event.target.value as BasemapKey)}>
              {Object.entries(basemaps).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fp-overlay-toggle">
            <input
              type="checkbox"
              checked={showAirspaces}
              onChange={(event) => setShowAirspaces(event.target.checked)}
            />
            Visa luftrum
          </label>
        </div>
      </div>

      <div className="fp-map-canvas">
        {waypoints.length === 0 && (
          <div className="fp-map-empty-hint">
            Klicka i kartan för att välja startpunkten
          </div>
        )}
        {hasPendingStartPoint && (
          <div className="fp-map-empty-hint">
            Startpunkt vald. Klicka igen i kartan för nästa waypoint.
          </div>
        )}
        <MapContainer center={center} zoom={7} scrollWheelZoom className="fp-leaflet-map">
          <Pane name="fp-navaid-pane" style={{ zIndex: 530 }} />
          <Pane name="fp-airport-pane" style={{ zIndex: 560 }} />
          <TileLayer attribution={basemaps[basemap].attribution} url={basemaps[basemap].url} />
          <MapInstanceHandler onReady={setMapInstance} />
          <InitialViewportHandler
            waypoints={displayWaypoints}
            focusedLegIndex={focusedLegIndex}
            initialViewport={initialViewport}
          />
          <MapClickHandler onAddPoint={addPointToEnd} shouldSuppressClick={shouldSuppressClick} />
          <MapZoomHandler onZoomChange={setMapZoom} />
          <MapBoundsHandler onBoundsChange={setMapBounds} />
          {onViewportChange ? <MapViewportHandler onViewportChange={onViewportChange} /> : null}
          <RouteInsertDragHandler
            activeSegmentIndex={activeSegmentInsertIndex}
            onMove={updateSegmentInsertDrag}
            onEnd={endSegmentInsertDrag}
          />
          <FocusLegHandler plan={plan} focusedLegIndex={focusedLegIndex} />

          {showAirspaces ? (
            <GeoJSON
              data={airspaceGeoJson}
              style={(feature) => {
                const kind = feature?.properties?.kind
                const palette = {
                  CTR: { color: '#cc5d00', fillColor: '#ffb46b' },
                  TMA: { color: '#005db5', fillColor: '#82b8ff' },
                  TIA: { color: '#0a6b5d', fillColor: '#7ad8c7' },
                  TIZ: { color: '#0f7a38', fillColor: '#8ae69d' },
                  R: { color: '#b11717', fillColor: '#ff8a8a' },
                  D: { color: '#7b3b00', fillColor: '#f0b16b' },
                  ATZ: { color: '#007a4d', fillColor: '#7adca8' },
                  TRA: { color: '#8f1e8f', fillColor: '#e59cf4' },
                } as const
                const current = palette[kind as keyof typeof palette] ?? palette.CTR

                return {
                  color: current.color,
                  weight: 1.25,
                  opacity: 0.9,
                  fillColor: current.fillColor,
                  fillOpacity: 0.12,
                }
              }}
              onEachFeature={(_feature, layer) => {
                layer.bindTooltip('', {
                  sticky: true,
                  opacity: 0.95,
                  offset: [14, -10],
                })
                layer.on('mouseover mousemove', (event) => {
                  const pointer = event as LeafletMouseEvent
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
                    return
                  }

                  layer.setTooltipContent(formatAirspaceTooltipContent(matchingAirspaces))
                  if (!layer.isTooltipOpen()) {
                    layer.openTooltip(pointer.latlng)
                  }
                })
                layer.on('click', (event) => {
                  const clicked = event as LeafletMouseEvent
                  clicked.originalEvent?.preventDefault?.()
                  clicked.originalEvent?.stopPropagation?.()
                  addPointToEnd(clicked.latlng.lat, clicked.latlng.lng)
                })
              }}
            />
          ) : null}

          {routeWeatherOverlays.map((overlay) => {
            const tooltipContent = (
              <Tooltip sticky opacity={0.95} className="fp-weather-overlay-tooltip">
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
                  pathOptions={{
                    color: sigmetOverlayPalette.color,
                    weight: 2,
                    fillColor: sigmetOverlayPalette.fillColor,
                    fillOpacity: 0.16,
                    dashArray: '6 4',
                  }}
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
                  pathOptions={{
                    color: sigmetOverlayPalette.lineColor,
                    weight: 3,
                    opacity: 0.95,
                    dashArray: '8 6',
                  }}
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
                    weight: 2,
                    fillColor: sigmetOverlayPalette.fillColor,
                    fillOpacity: 0.12,
                    dashArray: '6 4',
                  }}
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
              >
                {tooltipContent}
              </CircleMarker>
            )
          })}

          {mapZoom >= navaidMinZoom
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
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -6]} opacity={0.95} className="fp-navaid-tooltip">
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

          {swedishAirports.map((airport) => {
            const airportMetar = airport.icao ? airportMetarsByIcao[airport.icao] : null
            const flightRules = classifyMetarFlightRules(airportMetar?.metarRawText ?? null)

            return (
            <Marker
              key={airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`}
              position={[airport.lat, airport.lon]}
              icon={createAirportIcon(flightRules.category)}
              pane="fp-airport-pane"
              keyboard={false}
              zIndexOffset={90}
              eventHandlers={{
                click: (event) => {
                  event.originalEvent.preventDefault()
                  event.originalEvent.stopPropagation()
                  addPointToEnd(airport.lat, airport.lon)
                },
              }}
            >
              {airport.icao && mapZoom >= airportLabelMinZoom ? (
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
              <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                <div className="fp-airport-tooltip">
                  <strong>{airport.icao}</strong>
                  <span>{airport.name}</span>
                  {airportMetar?.metarRawText ? <span>{airportMetar.metarRawText}</span> : null}
                  <span>{formatCoordinateDms(airport.lat, 'lat')} {formatCoordinateDms(airport.lon, 'lon')}</span>
                </div>
              </Tooltip>
            </Marker>
          )})}

          {previewRouteLegs.map((leg, index) => (
            <FeatureGroup key={`segment-${index}`}>
              <Polyline
                positions={[
                  [leg.from.lat, leg.from.lon],
                  [leg.to.lat, leg.to.lon],
                ]}
                pathOptions={{ color: '#ff35c4', weight: routeLineWeight }}
                eventHandlers={{
                  mousedown: (event) => {
                    event.originalEvent.preventDefault()
                    event.originalEvent.stopPropagation()
                    startSegmentInsertDrag(index, event.latlng.lat, event.latlng.lng)
                  },
                }}
              >
                <Tooltip sticky opacity={1} className="fp-segment-tooltip">
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
            </FeatureGroup>
          ))}

          {displayWaypoints.map((point, index) => (
            <Marker
              key={`waypoint-${waypointMarkerLayerVersion}-${index}`}
              position={[point.lat, point.lon]}
              icon={waypointIcon}
              draggable={displayWaypoints.length > 1}
              eventHandlers={{
                dragstart: () => {
                  suppressNextMapClick.current = true
                  setDragPreviewWaypoints(waypoints)
                },
                drag: (event) => {
                  const marker = event.target as L.Marker
                  const latLng = marker.getLatLng()
                  previewMoveWaypoint(index, latLng.lat, latLng.lng)
                },
                dragend: (event) => {
                  const marker = event.target as L.Marker
                  const latLng = marker.getLatLng()
                  updateWaypoint(index, latLng.lat, latLng.lng)
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1} className="fp-waypoint-tooltip">
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
                    disabled={waypoints.length <= 2}
                  >
                    Ta bort waypoint
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

      </div>
    </section>
  )
}
