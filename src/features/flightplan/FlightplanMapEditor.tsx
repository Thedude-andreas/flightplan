import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  FeatureGroup,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
  useMap,
} from 'react-leaflet'
import L, { divIcon, type LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { calculateFlightPlan, formatTimeFromMinutes } from './calculations'
import { formatCoordinateDms } from './coordinates'
import { getRoutePointLabel, legsToWaypoints, pointWithNearestName, waypointsToLegs } from './gazetteer'
import { swedishAirspaces } from './generated/airspaces.se'
import { swedishAirports } from './generated/airports.se'
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

const routeLineWeight = 6
const airportLabelMinZoom = 8
const airportMarkerRadiusPx = 4
const directionArrowWaypointClearancePx = 22
const maxVisibleAirspaceLowerFt = 9500

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
  airspace: (typeof swedishAirspaces)[number],
  lat: number,
  lon: number,
) {
  return geometryContainsPoint(airspace.geometry, lat, lon)
}

function geometryContainsPoint(
  geometry: (typeof swedishAirspaces)[number]['geometry'],
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
  onRouteLegsChange,
  focusedLegIndex = null,
}: {
  plan: FlightPlanInput
  derived: FlightPlanDerived
  onRouteLegsChange: (legs: FlightPlanInput['routeLegs']) => void
  focusedLegIndex?: number | null
}) {
  const [basemap, setBasemap] = useState<BasemapKey>('topo')
  const [showAirspaces, setShowAirspaces] = useState(true)
  const [mapZoom, setMapZoom] = useState(7)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [dragPreviewWaypoints, setDragPreviewWaypoints] = useState<ReturnType<typeof legsToWaypoints> | null>(null)
  const [activeSegmentInsertIndex, setActiveSegmentInsertIndex] = useState<number | null>(null)
  const suppressNextMapClick = useRef(false)
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
          altitude: '',
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
          <TileLayer attribution={basemaps[basemap].attribution} url={basemaps[basemap].url} />
          <MapInstanceHandler onReady={setMapInstance} />
          <MapClickHandler onAddPoint={addPointToEnd} shouldSuppressClick={shouldSuppressClick} />
          <MapZoomHandler onZoomChange={setMapZoom} />
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

          {swedishAirports.map((airport) => (
            <CircleMarker
              key={airport.icao ?? `${airport.name}-${airport.lat}-${airport.lon}`}
              center={[airport.lat, airport.lon]}
              radius={4}
              pathOptions={{
                color: '#1f6bff',
                weight: 1,
                fillColor: '#e8f0ff',
                fillOpacity: 0.9,
              }}
            >
              {airport.icao && mapZoom >= airportLabelMinZoom ? (
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -10]}
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
                  <span>{formatCoordinateDms(airport.lat, 'lat')} {formatCoordinateDms(airport.lon, 'lon')}</span>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}

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
              key={`waypoint-${index}`}
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
