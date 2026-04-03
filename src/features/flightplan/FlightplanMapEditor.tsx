import { useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from 'react-leaflet'
import L, { divIcon, type DragEndEvent, type LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { calculateFlightPlan, formatTimeFromMinutes } from './calculations'
import { formatCoordinateDms } from './coordinates'
import { legsToWaypoints, pointWithNearestName, waypointsToLegs } from './gazetteer'
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

const midpointIcon = divIcon({
  className: 'fp-midpoint-icon',
  html: '<span>+</span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

function midpoint(a: FlightPlanInput['routeLegs'][number]['from'], b: FlightPlanInput['routeLegs'][number]['to']) {
  return {
    lat: (a.lat + b.lat) / 2,
    lon: (a.lon + b.lon) / 2,
  }
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

export function FlightplanMapEditor({
  plan,
  derived,
  onRouteLegsChange,
}: {
  plan: FlightPlanInput
  derived: FlightPlanDerived
  onRouteLegsChange: (legs: FlightPlanInput['routeLegs']) => void
}) {
  const [basemap, setBasemap] = useState<BasemapKey>('topo')
  const [showAirspaces, setShowAirspaces] = useState(true)
  const [dragPreviewWaypoints, setDragPreviewWaypoints] = useState<ReturnType<typeof legsToWaypoints> | null>(null)
  const [midpointInsertIndex, setMidpointInsertIndex] = useState<number | null>(null)
  const suppressNextMapClick = useRef(false)
  const lastMidpointDragPosition = useRef<{ lat: number; lon: number } | null>(null)
  const waypoints = useMemo(() => legsToWaypoints(plan.routeLegs), [plan.routeLegs])
  const displayWaypoints = dragPreviewWaypoints ?? waypoints
  const previewRouteLegs = useMemo(
    () => waypointsToLegs(displayWaypoints, plan.routeLegs, derived.aircraft.cruiseTasKt),
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
      features: swedishAirspaces.map((airspace) => ({
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

  const setWaypoints = (nextWaypoints: typeof waypoints) => {
    setDragPreviewWaypoints(null)
    setMidpointInsertIndex(null)
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

  const addPointToEnd = (lat: number, lon: number) => {
    const nextPoint = pointWithNearestName(lat, lon)
    if (waypoints.length === 0) {
      return
    }
    setWaypoints([...waypoints, nextPoint])
  }

  const previewMoveWaypoint = (index: number, lat: number, lon: number) => {
    setDragPreviewWaypoints(
      waypoints.map((point, pointIndex) =>
        pointIndex === index ? { ...point, lat, lon } : point,
      ),
    )
  }

  const updateWaypoint = (index: number, lat: number, lon: number) => {
    const next = waypoints.map((point, pointIndex) =>
      pointIndex === index ? pointWithNearestName(lat, lon) : point,
    )
    setWaypoints(next)
  }

  const previewInsertWaypointAt = (index: number, lat: number, lon: number) => {
    const next = [...waypoints]
    next.splice(index, 0, {
      name: 'Ny waypoint',
      lat,
      lon,
    })
    setDragPreviewWaypoints(next)
  }

  const insertWaypointAt = (index: number, lat: number, lon: number) => {
    const next = [...waypoints]
    next.splice(index, 0, pointWithNearestName(lat, lon))
    setWaypoints(next)
  }

  const removeWaypoint = (index: number) => {
    if (waypoints.length <= 2) {
      return
    }
    setWaypoints(waypoints.filter((_, pointIndex) => pointIndex !== index))
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
        <MapContainer center={center} zoom={7} scrollWheelZoom className="fp-leaflet-map">
          <TileLayer attribution={basemaps[basemap].attribution} url={basemaps[basemap].url} />
          <MapClickHandler onAddPoint={addPointToEnd} shouldSuppressClick={shouldSuppressClick} />

          {showAirspaces ? (
            <GeoJSON
              data={airspaceGeoJson}
              style={(feature) => {
                const kind = feature?.properties?.kind
                const palette = {
                  CTR: { color: '#cc5d00', fillColor: '#ffb46b' },
                  TMA: { color: '#005db5', fillColor: '#82b8ff' },
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
              onEachFeature={(feature, layer) => {
                const props = feature.properties as {
                  kind?: string
                  name?: string
                  lower?: string
                  upper?: string
                  positionIndicator?: string
                }
                const lines = [
                  `<strong>${props.kind ?? 'Luftrum'}${props.name ? ` · ${props.name}` : ''}</strong>`,
                  props.positionIndicator ? `<span>${props.positionIndicator}</span>` : '',
                  `<span>${props.lower ?? '—'} till ${props.upper ?? '—'}</span>`,
                ].filter(Boolean)

                layer.bindTooltip(`<div class="fp-airspace-tooltip">${lines.join('')}</div>`, {
                  sticky: true,
                  opacity: 0.95,
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
            <Polyline
              key={`segment-${index}`}
              positions={[
                [leg.from.lat, leg.from.lon],
                [leg.to.lat, leg.to.lon],
              ]}
              pathOptions={{ color: '#ff35c4', weight: 4 }}
            >
              <Tooltip sticky opacity={1} className="fp-segment-tooltip">
                <div>
                  <strong>{leg.from.name} → {leg.to.name}</strong>
                  <span>TT {previewDerived.routeLegs[index]?.trueTrack ?? '—'}°</span>
                  <span>MH {previewDerived.routeLegs[index]?.magneticHeading ?? '—'}°</span>
                  <span>GS {previewDerived.routeLegs[index]?.groundSpeedKt ?? '—'} kt</span>
                  <span>Dist {previewDerived.routeLegs[index]?.distanceNm ?? '—'} nm</span>
                  <span>Tid {formatTimeFromMinutes(previewDerived.routeLegs[index]?.legTimeMinutes ?? 0)}</span>
                </div>
              </Tooltip>
            </Polyline>
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
                  <strong>{point.name}</strong>
                  <span>{formatCoordinateDms(point.lat, 'lat')} {formatCoordinateDms(point.lon, 'lon')}</span>
                </div>
              </Tooltip>
              <Popup className="fp-waypoint-popup" autoPan closeButton>
                <div
                  className="fp-waypoint-popup__content"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <strong>{point.name}</strong>
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

          {plan.routeLegs.map((leg, index) => {
            const mid = midpoint(leg.from, leg.to)
            return (
              <Marker
                key={`midpoint-${index}`}
                position={[mid.lat, mid.lon]}
                icon={midpointIcon}
                draggable
                eventHandlers={{
                  dragstart: (event) => {
                    suppressNextMapClick.current = true
                    setMidpointInsertIndex(index + 1)
                    const marker = event.target as L.Marker
                    const latLng = marker.getLatLng()
                    lastMidpointDragPosition.current = { lat: latLng.lat, lon: latLng.lng }
                    previewInsertWaypointAt(index + 1, latLng.lat, latLng.lng)
                  },
                  drag: (event) => {
                    const marker = event.target as L.Marker
                    const latLng = marker.getLatLng()
                    lastMidpointDragPosition.current = { lat: latLng.lat, lon: latLng.lng }
                    setDragPreviewWaypoints((current) => {
                      if (!current) {
                        const next = [...waypoints]
                        next.splice(index + 1, 0, {
                          name: 'Ny waypoint',
                          lat: latLng.lat,
                          lon: latLng.lng,
                        })
                        return next
                      }

                      return current.map((point, pointIndex) =>
                        pointIndex === index + 1 ? { ...point, lat: latLng.lat, lon: latLng.lng } : point,
                      )
                    })
                  },
                  dragend: (event: DragEndEvent) => {
                    const marker = event.target as L.Marker
                    const markerLatLng = marker.getLatLng()
                    const latLng = lastMidpointDragPosition.current ?? { lat: markerLatLng.lat, lon: markerLatLng.lng }
                    const insertIndex = midpointInsertIndex ?? index + 1

                    if (dragPreviewWaypoints) {
                      const next = dragPreviewWaypoints.map((point, pointIndex) =>
                        pointIndex === insertIndex ? pointWithNearestName(latLng.lat, latLng.lon) : point,
                      )
                      lastMidpointDragPosition.current = null
                      setWaypoints(next)
                      return
                    }

                    lastMidpointDragPosition.current = null
                    insertWaypointAt(insertIndex, latLng.lat, latLng.lon)
                  },
                  click: (event: LeafletMouseEvent) => {
                    const { lat, lng } = event.latlng
                    insertWaypointAt(index + 1, lat, lng)
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  Dra eller klicka för ny waypoint
                </Tooltip>
              </Marker>
            )
          })}
        </MapContainer>

      </div>
    </section>
  )
}
