import { useMemo, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMapEvents,
} from 'react-leaflet'
import L, { divIcon, type DragEndEvent, type LeafletMouseEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { formatTimeFromMinutes } from './calculations'
import { legsToWaypoints, pointWithNearestName, waypointsToLegs } from './gazetteer'
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

function MapClickHandler({ onAddPoint }: { onAddPoint: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event) {
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
  const waypoints = useMemo(() => legsToWaypoints(plan.routeLegs), [plan.routeLegs])
  const center = useMemo<[number, number]>(() => {
    if (waypoints.length === 0) {
      return [62.0, 17.5]
    }

    const avgLat = waypoints.reduce((sum, point) => sum + point.lat, 0) / waypoints.length
    const avgLon = waypoints.reduce((sum, point) => sum + point.lon, 0) / waypoints.length
    return [avgLat, avgLon]
  }, [waypoints])

  const setWaypoints = (nextWaypoints: typeof waypoints) => {
    const nextLegs = waypointsToLegs(nextWaypoints, plan.routeLegs, derived.aircraft.cruiseTasKt)
    onRouteLegsChange(nextLegs)
  }

  const addPointToEnd = (lat: number, lon: number) => {
    const nextPoint = pointWithNearestName(lat, lon)
    if (waypoints.length === 0) {
      return
    }
    setWaypoints([...waypoints, nextPoint])
  }

  const updateWaypoint = (index: number, lat: number, lon: number) => {
    const next = waypoints.map((point, pointIndex) =>
      pointIndex === index ? pointWithNearestName(lat, lon) : point,
    )
    setWaypoints(next)
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
        <div>
          <p className="fp-panel-eyebrow">Karteditor</p>
          <h3>Magenta färdlinje med redigerbara waypoints</h3>
        </div>
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
      </div>

      <div className="fp-map-canvas">
        <MapContainer center={center} zoom={7} scrollWheelZoom className="fp-leaflet-map">
          <TileLayer attribution={basemaps[basemap].attribution} url={basemaps[basemap].url} />
          <MapClickHandler onAddPoint={addPointToEnd} />

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
                  <span>{airport.lat.toFixed(4)}, {airport.lon.toFixed(4)}</span>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}

          {plan.routeLegs.map((leg, index) => (
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
                  <span>TT {derived.routeLegs[index]?.trueTrack ?? '—'}°</span>
                  <span>MH {derived.routeLegs[index]?.magneticHeading ?? '—'}°</span>
                  <span>GS {derived.routeLegs[index]?.groundSpeedKt ?? '—'} kt</span>
                  <span>Dist {derived.routeLegs[index]?.distanceNm ?? '—'} nm</span>
                  <span>Tid {formatTimeFromMinutes(derived.routeLegs[index]?.legTimeMinutes ?? 0)}</span>
                </div>
              </Tooltip>
            </Polyline>
          ))}

          {waypoints.map((point, index) => (
            <Marker
              key={`waypoint-${index}`}
              position={[point.lat, point.lon]}
              icon={waypointIcon}
              draggable={waypoints.length > 1}
              eventHandlers={{
                dragend: (event) => {
                  const marker = event.target as L.Marker
                  const latLng = marker.getLatLng()
                  updateWaypoint(index, latLng.lat, latLng.lng)
                },
                contextmenu: () => removeWaypoint(index),
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1} className="fp-waypoint-tooltip">
                <div>
                  <strong>{point.name}</strong>
                  <span>{point.lat.toFixed(4)}, {point.lon.toFixed(4)}</span>
                  <span>Högerklick för att radera</span>
                </div>
              </Tooltip>
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
                  dragend: (event: DragEndEvent) => {
                    const marker = event.target as L.Marker
                    const latLng = marker.getLatLng()
                    insertWaypointAt(index + 1, latLng.lat, latLng.lng)
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
