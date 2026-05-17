import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Pane, TileLayer, Tooltip, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import '../flightplan.css'
import type { SwedishAirspace, SwedishAirport, SwedishAirportFrequency, SwedishAirspaceFrequency, SwedishNavaid } from '../aviationData'

type PlaceEntry = {
  id?: string
  name: string
  lat: number
  lon: number
  kind: string
  importance?: number
}

type AirportPayload = {
  airports?: Array<{
    icao: string | null
    name: string | null
    category: string | null
    detailsInAd2: boolean
    lat?: number
    lon?: number
    arp?: {
      lat: number
      lon: number
    } | null
  }>
}

type AirspacePayload = {
  airspaces?: SwedishAirspace[]
}

type RadioNavPayload = {
  navaids?: SwedishNavaid[]
}

type FrequencyChange<T> = {
  state: ChangeState
  previous: T | null
  next: T
}

type PlacesPayload = PlaceEntry[] | {
  places?: PlaceEntry[]
}

type DataSet = {
  airports: SwedishAirport[]
  airspaces: SwedishAirspace[]
  navaids: SwedishNavaid[]
  places: PlaceEntry[]
  airportFrequencies: SwedishAirportFrequency[]
  airspaceFrequencies: SwedishAirspaceFrequency[]
}

type ChangeState = 'added' | 'changed'

type ChangedAirspace = {
  state: ChangeState
  previous: SwedishAirspace | null
  next: SwedishAirspace
  geometryChanged: boolean
}

type PointChange<T> = {
  state: ChangeState
  previous: T | null
  next: T
}

type PreviewDiff = {
  airspaces: ChangedAirspace[]
  airports: Array<PointChange<SwedishAirport>>
  navaids: Array<PointChange<SwedishNavaid>>
  places: Array<PointChange<PlaceEntry>>
  airportFrequencies: Array<FrequencyChange<SwedishAirportFrequency>>
  airspaceFrequencies: Array<FrequencyChange<SwedishAirspaceFrequency>>
  airportFrequencyMarkers: Array<{ change: FrequencyChange<SwedishAirportFrequency>; airport: SwedishAirport }>
  airspaceFrequencyAirspaces: SwedishAirspace[]
}

const currentBaseUrlParam = 'aviationDataCurrentBaseUrl'
const candidateBaseUrlParam = 'aviationDataBaseUrl'

const basemap = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function getCandidateBaseUrl() {
  const value = new URLSearchParams(window.location.search).get(candidateBaseUrlParam)?.trim()
  return value && /^https?:\/\//i.test(value) ? normalizeBaseUrl(value) : null
}

function inferCurrentBaseUrl(candidateBaseUrl: string) {
  return candidateBaseUrl.replace(/\/candidates\/[^/]+$/u, '/current')
}

function getCurrentBaseUrl(candidateBaseUrl: string) {
  const value = new URLSearchParams(window.location.search).get(currentBaseUrlParam)?.trim()
  return value && /^https?:\/\//i.test(value) ? normalizeBaseUrl(value) : inferCurrentBaseUrl(candidateBaseUrl)
}

async function fetchJson<T>(baseUrl: string, fileName: string): Promise<T> {
  const response = await fetch(`${baseUrl}/${fileName}`)
  if (!response.ok) {
    throw new Error(`Kunde inte ladda ${fileName} (${response.status}).`)
  }

  return response.json() as Promise<T>
}

function normalizeAirports(payload: AirportPayload): SwedishAirport[] {
  return (payload.airports ?? [])
    .map((airport) => {
      const lat = airport.arp?.lat ?? airport.lat
      const lon = airport.arp?.lon ?? airport.lon
      if (lat == null || lon == null) {
        return null
      }

      return {
        icao: airport.icao,
        name: airport.name,
        lat,
        lon,
        category: airport.category,
        detailsInAd2: airport.detailsInAd2,
      }
    })
    .filter((airport): airport is SwedishAirport => Boolean(airport))
}

function normalizePlaces(payload: PlacesPayload): PlaceEntry[] {
  const rawPlaces = Array.isArray(payload) ? payload : payload.places ?? []
  return rawPlaces
    .map((place) => {
      if (Array.isArray(place)) {
        const [name, lat, lon, kind, importance] = place as unknown as [string, number, number, string, number?]
        return {
          name,
          lat,
          lon,
          kind: normalizePlaceKind(kind),
          importance,
        }
      }

      return {
        ...place,
        kind: normalizePlaceKind(place.kind),
      }
    })
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon))
}

function normalizePlaceKind(kind: string) {
  if (kind === 's') return 'settlement'
  if (kind === 'l') return 'lake'
  if (kind === 'i') return 'island'
  if (kind === 'w') return 'water'
  if (kind === 'm') return 'mountain'
  return kind
}

async function loadDataSet(baseUrl: string): Promise<DataSet> {
  const [airports, airspaces, radioNav, places, airportFrequencies, airspaceFrequencies] = await Promise.all([
    fetchJson<AirportPayload>(baseUrl, 'airports.se.json'),
    fetchJson<AirspacePayload>(baseUrl, 'airspaces.se.json'),
    fetchJson<RadioNavPayload>(baseUrl, 'radio-nav.se.json'),
    fetchJson<PlacesPayload>(baseUrl, 'places.se.json'),
    fetchJson<SwedishAirportFrequency[]>(baseUrl, 'airport-frequencies.se.json'),
    fetchJson<SwedishAirspaceFrequency[]>(baseUrl, 'airspace-frequencies.se.json'),
  ])

  return {
    airports: normalizeAirports(airports),
    airspaces: airspaces.airspaces ?? [],
    navaids: radioNav.navaids ?? [],
    places: normalizePlaces(places),
    airportFrequencies,
    airspaceFrequencies,
  }
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  return `{${Object.entries(value)
    .filter(([key]) => key !== 'generatedAt' && key !== 'source' && key !== 'inputPath' && key !== 'ad2Source')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(5))
}

function roundPlaceCoordinate(value: number) {
  return Number(value.toFixed(2))
}

function roundGeometryCoordinates(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => roundGeometryCoordinates(item))
  }

  return typeof value === 'number' ? roundCoordinate(value) : value
}

function airportKey(airport: SwedishAirport) {
  return airport.icao ?? `${airport.name}:${roundCoordinate(airport.lat)}:${roundCoordinate(airport.lon)}`
}

function airspaceKey(airspace: SwedishAirspace) {
  return `${airspace.positionIndicator ?? ''}:${airspace.kind}:${airspace.name}:${airspace.location ?? ''}`
}

function navaidKey(navaid: SwedishNavaid) {
  return `${navaid.kind}:${navaid.ident ?? ''}:${navaid.positionIndicator ?? ''}:${navaid.name ?? ''}`
}

function placeKey(place: PlaceEntry) {
  return `${place.name}:${place.kind}:${roundPlaceCoordinate(place.lat)}:${roundPlaceCoordinate(place.lon)}`
}

function pointChanged(left: { lat: number; lon: number }, right: { lat: number; lon: number }) {
  return roundCoordinate(left.lat) !== roundCoordinate(right.lat) || roundCoordinate(left.lon) !== roundCoordinate(right.lon)
}

function diffPointItems<T extends { lat: number; lon: number }>(
  previousItems: T[],
  nextItems: T[],
  keyFor: (item: T) => string,
  coordinatePrecision: 'point' | 'place' = 'point',
  comparableFor: (item: T) => unknown = (item) => item,
): Array<PointChange<T>> {
  const previousByKey = new Map(previousItems.map((item) => [keyFor(item), item]))
  const changes: Array<PointChange<T>> = []

  for (const next of nextItems) {
    const previous = previousByKey.get(keyFor(next))
    if (!previous) {
      changes.push({ state: 'added', previous: null, next })
      continue
    }

    const nextComparableBase = comparableFor(next) as T
    const previousComparableBase = comparableFor(previous) as T
    const nextComparable = coordinatePrecision === 'place'
      ? { ...nextComparableBase, lat: roundPlaceCoordinate(next.lat), lon: roundPlaceCoordinate(next.lon) }
      : nextComparableBase
    const previousComparable = coordinatePrecision === 'place'
      ? { ...previousComparableBase, lat: roundPlaceCoordinate(previous.lat), lon: roundPlaceCoordinate(previous.lon) }
      : previousComparableBase

    if (stableStringify(previousComparable) !== stableStringify(nextComparable) || pointChanged(previousComparable, nextComparable)) {
      changes.push({ state: 'changed', previous, next })
    }
  }

  return changes
}

function distanceNm(left: { lat: number; lon: number }, right: { lat: number; lon: number }) {
  const earthRadiusNm = 3440.065
  const latDelta = ((right.lat - left.lat) * Math.PI) / 180
  const lonDelta = ((right.lon - left.lon) * Math.PI) / 180
  const leftLat = (left.lat * Math.PI) / 180
  const rightLat = (right.lat * Math.PI) / 180
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lonDelta / 2) ** 2

  return 2 * earthRadiusNm * Math.asin(Math.sqrt(haversine))
}

function closestPlace(previousPlaces: PlaceEntry[], nextPlace: PlaceEntry) {
  return previousPlaces
    .filter((place) => place.name === nextPlace.name && place.kind === nextPlace.kind)
    .reduce<{ place: PlaceEntry; distanceNm: number } | null>((best, place) => {
      const distance = distanceNm(place, nextPlace)
      return !best || distance < best.distanceNm ? { place, distanceNm: distance } : best
    }, null)
}

function diffPlaces(previousPlaces: PlaceEntry[], nextPlaces: PlaceEntry[]): Array<PointChange<PlaceEntry>> {
  const changes: Array<PointChange<PlaceEntry>> = []

  for (const next of nextPlaces) {
    const closest = closestPlace(previousPlaces, next)
    if (!closest || closest.distanceNm > 3) {
      changes.push({ state: 'added', previous: null, next })
    } else if (closest.distanceNm > 1) {
      changes.push({ state: 'changed', previous: closest.place, next })
    }
  }

  return changes
}

function comparableAirspace(airspace: SwedishAirspace) {
  const { id, effectiveFrom, ...comparable } = airspace
  void id
  void effectiveFrom
  return {
    ...comparable,
    geometry: {
      ...airspace.geometry,
      coordinates: roundGeometryCoordinates(airspace.geometry.coordinates),
    },
  }
}

function comparableNavaid(navaid: SwedishNavaid) {
  const { id, ...comparable } = navaid
  void id
  return {
    ...comparable,
    lat: roundCoordinate(navaid.lat),
    lon: roundCoordinate(navaid.lon),
  }
}

function frequencyList(record: { frequencies: string[] }) {
  return record.frequencies.join(', ')
}

function airportFrequencyKey(record: SwedishAirportFrequency) {
  return `${record.positionIndicator}:${record.kind}:${record.unit}:${record.hours ?? ''}:${record.remarks ?? ''}`
}

function airspaceFrequencyKey(record: SwedishAirspaceFrequency) {
  return `${record.positionIndicator ?? ''}:${record.kind}:${record.name}:${record.unit ?? record.callSign ?? ''}`
}

function diffFrequencyItems<T>(
  previousItems: T[],
  nextItems: T[],
  keyFor: (item: T) => string,
): Array<FrequencyChange<T>> {
  const previousByKey = new Map(previousItems.map((item) => [keyFor(item), item]))
  const changes: Array<FrequencyChange<T>> = []

  for (const next of nextItems) {
    const previous = previousByKey.get(keyFor(next))
    if (!previous) {
      changes.push({ state: 'added', previous: null, next })
      continue
    }

    if (stableStringify(previous) !== stableStringify(next)) {
      changes.push({ state: 'changed', previous, next })
    }
  }

  return changes
}

function buildDiff(previous: DataSet, next: DataSet): PreviewDiff {
  const previousAirspaces = new Map(previous.airspaces.map((airspace) => [airspaceKey(airspace), airspace]))
  const airspaces: ChangedAirspace[] = []

  for (const nextAirspace of next.airspaces) {
    const previousAirspace = previousAirspaces.get(airspaceKey(nextAirspace))
    if (!previousAirspace) {
      airspaces.push({
        state: 'added',
        previous: null,
        next: nextAirspace,
        geometryChanged: true,
      })
      continue
    }

    if (stableStringify(comparableAirspace(previousAirspace)) !== stableStringify(comparableAirspace(nextAirspace))) {
      airspaces.push({
        state: 'changed',
        previous: previousAirspace,
        next: nextAirspace,
        geometryChanged: stableStringify(previousAirspace.geometry) !== stableStringify(nextAirspace.geometry),
      })
    }
  }

  const airportFrequencies = diffFrequencyItems(previous.airportFrequencies, next.airportFrequencies, airportFrequencyKey)
  const airspaceFrequencies = diffFrequencyItems(previous.airspaceFrequencies, next.airspaceFrequencies, airspaceFrequencyKey)

  return {
    airspaces,
    airports: diffPointItems(previous.airports, next.airports, airportKey),
    navaids: diffPointItems(previous.navaids, next.navaids, navaidKey, 'point', comparableNavaid),
    places: diffPlaces(previous.places, next.places).filter((change) => (change.next.importance ?? 0) >= 0.8),
    airportFrequencies,
    airspaceFrequencies,
    airportFrequencyMarkers: airportFrequencies
      .map((change) => {
        const airport = matchAirportForFrequency(next.airports, change.next)
        return airport ? { change, airport } : null
      })
      .filter((item): item is { change: FrequencyChange<SwedishAirportFrequency>; airport: SwedishAirport } => Boolean(item)),
    airspaceFrequencyAirspaces: airspaceFrequencies
      .map((change) => matchAirspaceForFrequency(next.airspaces, change.next))
      .filter((airspace): airspace is SwedishAirspace => Boolean(airspace)),
  }
}

function matchAirportForFrequency(airports: SwedishAirport[], record: SwedishAirportFrequency) {
  return airports.find((airport) => airport.icao === record.positionIndicator) ?? null
}

function matchAirspaceForFrequency(airspaces: SwedishAirspace[], record: SwedishAirspaceFrequency) {
  const normalizedName = record.name.toLowerCase()
  return airspaces.find((airspace) =>
    airspace.positionIndicator === record.positionIndicator &&
    airspace.kind === record.kind &&
    (airspace.name?.toLowerCase() === normalizedName || airspace.location?.toLowerCase() === normalizedName),
  ) ?? null
}

function toGeoJson(airspaces: SwedishAirspace[]) {
  return {
    type: 'FeatureCollection' as const,
    features: airspaces.map((airspace) => ({
      type: 'Feature' as const,
      properties: {
        id: airspace.id,
        kind: airspace.kind,
        name: airspace.name,
        lower: airspace.lower,
        upper: airspace.upper,
      },
      geometry: airspace.geometry,
    })),
  }
}

function airspaceLabel(airspace: SwedishAirspace) {
  return [airspace.kind, airspace.name, airspace.lower && airspace.upper ? `${airspace.lower}-${airspace.upper}` : null]
    .filter(Boolean)
    .join(' · ')
}

function markerColor(state: ChangeState) {
  return state === 'added' ? '#0f8f55' : '#d97706'
}

function pointLabel(item: { name?: string | null; icao?: string | null; ident?: string | null; kind?: string | null }) {
  return [item.icao ?? item.ident, item.name, item.kind].filter(Boolean).join(' · ')
}

function airportFrequencyLabel(change: FrequencyChange<SwedishAirportFrequency>) {
  return `${change.next.positionIndicator} ${change.next.unit} · ${change.previous ? `${frequencyList(change.previous)} -> ` : ''}${frequencyList(change.next)}`
}

function airspaceFrequencyLabel(change: FrequencyChange<SwedishAirspaceFrequency>) {
  return `${change.next.positionIndicator ?? ''} ${change.next.name} · ${change.previous ? `${frequencyList(change.previous)} -> ` : ''}${frequencyList(change.next)}`
}

export function AviationDataPreviewPage() {
  const candidateBaseUrl = getCandidateBaseUrl()
  const currentBaseUrl = candidateBaseUrl ? getCurrentBaseUrl(candidateBaseUrl) : null
  const hasPreviewUrls = Boolean(candidateBaseUrl && currentBaseUrl)
  const [state, setState] = useState<{ loading: boolean; error: string | null; diff: PreviewDiff | null }>({
    loading: hasPreviewUrls,
    error: null,
    diff: null,
  })

  useEffect(() => {
    if (!hasPreviewUrls || !candidateBaseUrl || !currentBaseUrl) {
      return
    }

    let cancelled = false
    Promise.all([loadDataSet(currentBaseUrl), loadDataSet(candidateBaseUrl)])
      .then(([previous, next]) => {
        if (!cancelled) {
          setState({ loading: false, error: null, diff: buildDiff(previous, next) })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : 'Kunde inte ladda previewdata.',
            diff: null,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [candidateBaseUrl, currentBaseUrl, hasPreviewUrls])

  const changedAirspacesWithPrevious = useMemo(
    () => state.diff?.airspaces.filter((change) => change.previous && change.geometryChanged).map((change) => change.previous as SwedishAirspace) ?? [],
    [state.diff],
  )
  const changedAirspacesNext = useMemo(
    () => state.diff?.airspaces.filter((change) => change.geometryChanged).map((change) => change.next) ?? [],
    [state.diff],
  )
  const textOnlyAirspaces = state.diff?.airspaces.filter((change) => !change.geometryChanged) ?? []
  const airportFrequencyMarkers = state.diff?.airportFrequencyMarkers ?? []
  const frequencyAirspaces = state.diff?.airspaceFrequencyAirspaces ?? []

  return (
    <section className="aviation-preview-page">
      <div className="aviation-preview-page__header">
        <div>
          <h1>Granska datauppdatering</h1>
          <p>Färgade objekt visar tillkommen eller ändrad kartdata. Grå luftrum är tidigare geometri.</p>
        </div>
        {state.diff ? (
          <dl>
            <div><dt>Luftrum</dt><dd>{state.diff.airspaces.length}</dd></div>
            <div><dt>Flygplatser</dt><dd>{state.diff.airports.length}</dd></div>
            <div><dt>Frekvenser</dt><dd>{state.diff.airportFrequencies.length + state.diff.airspaceFrequencies.length}</dd></div>
            <div><dt>NAV</dt><dd>{state.diff.navaids.length}</dd></div>
            <div><dt>Orter</dt><dd>{state.diff.places.length}</dd></div>
          </dl>
        ) : null}
      </div>

      {!hasPreviewUrls ? <div className="auth-notice auth-notice--error">Previewlänken saknar kandidatdata.</div> : null}
      {state.loading ? <div className="auth-status-card">Laddar preview...</div> : null}
      {state.error ? <div className="auth-notice auth-notice--error">{state.error}</div> : null}

      {state.diff ? (
        <div className="aviation-preview-page__grid">
          <div className="aviation-preview-map">
            <MapContainer center={[62, 17.5]} zoom={5} scrollWheelZoom zoomControl={false} className="aviation-preview-map__leaflet">
              <ZoomControl position="topright" />
              <Pane name="previous" style={{ zIndex: 430 }} />
              <Pane name="next" style={{ zIndex: 440 }} />
              <Pane name="points" style={{ zIndex: 455 }} />
              <TileLayer attribution={basemap.attribution} url={basemap.url} />

              {changedAirspacesWithPrevious.length > 0 ? (
                <GeoJSON
                  key={`previous-${changedAirspacesWithPrevious.map((airspace) => airspace.id).join(',')}`}
                  pane="previous"
                  data={toGeoJson(changedAirspacesWithPrevious)}
                  style={() => ({
                    color: '#5f6368',
                    weight: 2,
                    opacity: 0.8,
                    fillColor: '#9aa0a6',
                    fillOpacity: 0.16,
                    dashArray: '5 5',
                  })}
                />
              ) : null}

              {changedAirspacesNext.length > 0 ? (
                <GeoJSON
                  key={`next-${changedAirspacesNext.map((airspace) => airspace.id).join(',')}`}
                  pane="next"
                  data={toGeoJson(changedAirspacesNext)}
                  style={() => ({
                    color: '#dc2626',
                    weight: 3,
                    opacity: 0.95,
                    fillColor: '#f97316',
                    fillOpacity: 0.24,
                  })}
                  onEachFeature={(feature, layer) => {
                    layer.bindTooltip(airspaceLabel(feature.properties as SwedishAirspace), { sticky: true })
                  }}
                />
              ) : null}

              {frequencyAirspaces.length > 0 ? (
                <GeoJSON
                  key={`frequency-airspaces-${frequencyAirspaces.map((airspace) => airspace.id).join(',')}`}
                  pane="next"
                  data={toGeoJson(frequencyAirspaces)}
                  style={() => ({
                    color: '#2563eb',
                    weight: 3,
                    opacity: 0.95,
                    fillColor: '#60a5fa',
                    fillOpacity: 0.18,
                  })}
                  onEachFeature={(feature, layer) => {
                    layer.bindTooltip(`Frekvensändring · ${airspaceLabel(feature.properties as SwedishAirspace)}`, { sticky: true })
                  }}
                />
              ) : null}

              {state.diff.airports.slice(0, 250).map((change) => (
                <CircleMarker
                  key={`airport-${airportKey(change.next)}`}
                  pane="points"
                  center={[change.next.lat, change.next.lon]}
                  radius={7}
                  pathOptions={{ color: markerColor(change.state), fillColor: markerColor(change.state), fillOpacity: 0.9, weight: 2 }}
                >
                  <Tooltip>{pointLabel(change.next)}</Tooltip>
                </CircleMarker>
              ))}

              {airportFrequencyMarkers.slice(0, 250).map(({ change, airport }) => (
                <CircleMarker
                  key={`airport-frequency-${airportFrequencyKey(change.next)}`}
                  pane="points"
                  center={[airport.lat, airport.lon]}
                  radius={8}
                  pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 0.9, weight: 2 }}
                >
                  <Tooltip>{airportFrequencyLabel(change)}</Tooltip>
                </CircleMarker>
              ))}

              {state.diff.navaids.slice(0, 250).map((change) => (
                <CircleMarker
                  key={`navaid-${navaidKey(change.next)}`}
                  pane="points"
                  center={[change.next.lat, change.next.lon]}
                  radius={6}
                  pathOptions={{ color: '#7c3aed', fillColor: '#a78bfa', fillOpacity: 0.9, weight: 2 }}
                >
                  <Tooltip>{pointLabel(change.next)}</Tooltip>
                </CircleMarker>
              ))}

              {state.diff.places.slice(0, 300).map((change) => (
                <CircleMarker
                  key={`place-${placeKey(change.next)}`}
                  pane="points"
                  center={[change.next.lat, change.next.lon]}
                  radius={4}
                  pathOptions={{ color: markerColor(change.state), fillColor: markerColor(change.state), fillOpacity: 0.75, weight: 1 }}
                >
                  <Tooltip>{pointLabel(change.next)}</Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>

          <aside className="aviation-preview-panel">
            <h2>Text- och metadataändringar</h2>
            {textOnlyAirspaces.length === 0 ? (
              <p>Inga luftrum med enbart metadataändring.</p>
            ) : (
              <ul>
                {textOnlyAirspaces.slice(0, 24).map((change) => (
                  <li key={change.next.id}>{change.state === 'added' ? 'Tillkommet' : 'Ändrat'}: {airspaceLabel(change.next)}</li>
                ))}
              </ul>
            )}
            <h2>Frekvensändringar</h2>
            {state.diff.airportFrequencies.length + state.diff.airspaceFrequencies.length === 0 ? (
              <p>Inga frekvensändringar.</p>
            ) : (
              <ul>
                {state.diff.airspaceFrequencies.slice(0, 24).map((change) => (
                  <li key={`airspace-frequency-${airspaceFrequencyKey(change.next)}`}>{airspaceFrequencyLabel(change)}</li>
                ))}
                {state.diff.airportFrequencies.slice(0, 24).map((change) => (
                  <li key={`airport-frequency-${airportFrequencyKey(change.next)}`}>{airportFrequencyLabel(change)}</li>
                ))}
              </ul>
            )}
            <h2>Legend</h2>
            <ul>
              <li><span className="aviation-preview-panel__swatch is-old" /> Gammalt luftrum</li>
              <li><span className="aviation-preview-panel__swatch is-new" /> Nytt eller ändrat luftrum</li>
              <li><span className="aviation-preview-panel__swatch is-frequency" /> Frekvensändring</li>
              <li><span className="aviation-preview-panel__swatch is-nav" /> NAV-hjälpmedel</li>
              <li><span className="aviation-preview-panel__swatch is-added" /> Tillkomna punkter</li>
              <li><span className="aviation-preview-panel__swatch is-changed" /> Ändrade punkter</li>
            </ul>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
