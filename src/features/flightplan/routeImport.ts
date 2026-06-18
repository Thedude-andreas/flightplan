import { getSwedishAirports, getSwedishNavaids, getSwedishVisualPoints, getSwedishAviationDataBaseUrl } from './aviationData'
import { DEFAULT_ROUTE_TAS_KT, createEmptyFlightPlan } from './data'
import type { FlightPlanInput, RoutePointInput } from './types'
import { waypointsToLegs } from './gazetteer'
import type { SmartRouteImportWaypoint } from './api/smartRouteImport'

type PlaceKind = 'settlement' | 'lake' | 'water' | 'island' | 'mountain'
type CompactPlaceKind = 's' | 'l' | 'w' | 'i' | 'm'
type Place = {
  name: string
  lat: number
  lon: number
  kind: PlaceKind
  importance: number
}
type CompactPlace = [string, number, number, CompactPlaceKind, number]
type PlacesPayload = CompactPlace[] | {
  places?: Array<{
    name: string
    lat: number
    lon: number
    kind: PlaceKind | CompactPlaceKind
    importance?: number
  }>
}

export type ResolvedRouteImportWaypoint = {
  raw: string
  name: string
  lat: number | null
  lon: number | null
  notes: string | null
  estimatedCoordinate: boolean
  confidence: number
  status: 'resolved' | 'ambiguous' | 'unresolved'
  source: string
  candidates: Array<{
    name: string
    lat: number
    lon: number
    source: string
    score: number
  }>
}

let placesPromise: Promise<Place[]> | null = null

function normalizeName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('sv-SE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9åäö]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function expandPlaceKind(kind: PlaceKind | CompactPlaceKind): PlaceKind {
  switch (kind) {
    case 's':
      return 'settlement'
    case 'l':
      return 'lake'
    case 'w':
      return 'water'
    case 'i':
      return 'island'
    case 'm':
      return 'mountain'
    default:
      return kind
  }
}

async function loadPlaces() {
  if (!placesPromise) {
    placesPromise = fetch(`${getSwedishAviationDataBaseUrl()}/places.se.json`)
      .then(async (response) => {
        if (!response.ok) {
          return []
        }

        const payload = await response.json() as PlacesPayload
        if (Array.isArray(payload)) {
          return payload.map(([name, lat, lon, kind, importance]) => ({
            name,
            lat,
            lon,
            kind: expandPlaceKind(kind),
            importance,
          }))
        }

        return (payload.places ?? []).map((place) => ({
          name: place.name,
          lat: place.lat,
          lon: place.lon,
          kind: expandPlaceKind(place.kind),
          importance: place.importance ?? 0,
        }))
      })
      .catch(() => [])
  }

  return placesPromise
}

function coordinateCandidate(point: SmartRouteImportWaypoint) {
  if (typeof point.lat !== 'number' || typeof point.lon !== 'number') {
    return null
  }

  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return null
  }

  if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) {
    return null
  }

  return {
    name: point.name?.trim() || point.raw || `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`,
    lat: point.lat,
    lon: point.lon,
    source: point.estimatedCoordinate ? 'Uppskattad koordinat' : 'Koordinat',
    score: point.estimatedCoordinate ? Math.min(point.confidence ?? 0.55, 0.68) : 1,
  }
}

function scoreCandidate(search: string, candidate: string, baseScore: number) {
  const normalizedSearch = normalizeName(search)
  const normalizedCandidate = normalizeName(candidate)
  if (!normalizedSearch || !normalizedCandidate) {
    return 0
  }

  if (normalizedCandidate === normalizedSearch) {
    return baseScore
  }

  if (normalizedCandidate.startsWith(normalizedSearch)) {
    return baseScore * 0.92
  }

  if (normalizedCandidate.includes(normalizedSearch)) {
    return baseScore * 0.78
  }

  return 0
}

async function findCandidates(point: SmartRouteImportWaypoint) {
  const coordinate = coordinateCandidate(point)
  if (coordinate) {
    return [coordinate]
  }

  const search = point.name?.trim() || point.raw.trim()
  const candidates: Array<{ name: string; lat: number; lon: number; source: string; score: number }> = []

  for (const airport of getSwedishAirports()) {
    const label = [airport.icao, airport.name].filter(Boolean).join(' ')
    const score = Math.max(
      scoreCandidate(search, airport.icao ?? '', 1),
      scoreCandidate(search, airport.name ?? '', 0.96),
      scoreCandidate(search, label, 0.94),
    )
    if (score > 0) {
      candidates.push({
        name: airport.icao ? `${airport.icao} ${airport.name ?? ''}`.trim() : airport.name ?? search,
        lat: airport.lat,
        lon: airport.lon,
        source: 'Flygplats',
        score,
      })
    }
  }

  for (const pointEntry of getSwedishVisualPoints()) {
    const label = [pointEntry.name, pointEntry.location, pointEntry.positionIndicator].filter(Boolean).join(' ')
    const score = Math.max(
      scoreCandidate(search, pointEntry.name ?? '', 0.9),
      scoreCandidate(search, label, 0.82),
    )
    if (score > 0) {
      candidates.push({
        name: pointEntry.name ?? pointEntry.location ?? search,
        lat: pointEntry.lat,
        lon: pointEntry.lon,
        source: 'VFR-punkt',
        score,
      })
    }
  }

  for (const navaid of getSwedishNavaids()) {
    const label = [navaid.ident, navaid.name, navaid.positionIndicator].filter(Boolean).join(' ')
    const score = Math.max(
      scoreCandidate(search, navaid.ident ?? '', 0.88),
      scoreCandidate(search, navaid.name ?? '', 0.84),
      scoreCandidate(search, label, 0.8),
    )
    if (score > 0) {
      candidates.push({
        name: navaid.ident ? `${navaid.ident} ${navaid.name ?? ''}`.trim() : navaid.name ?? search,
        lat: navaid.lat,
        lon: navaid.lon,
        source: 'Radionav',
        score,
      })
    }
  }

  const places = await loadPlaces()
  for (const place of places) {
    const score = scoreCandidate(search, place.name, 0.7 + Math.min(0.2, place.importance * 0.2))
    if (score > 0) {
      candidates.push({
        name: place.name,
        lat: place.lat,
        lon: place.lon,
        source: place.kind === 'lake' ? 'Sjö' : 'Plats',
        score,
      })
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

export async function resolveImportedWaypoints(points: SmartRouteImportWaypoint[]) {
  const resolved: ResolvedRouteImportWaypoint[] = []

  for (const point of points) {
    const candidates = await findCandidates(point)
    const best = candidates[0]
    const second = candidates[1]
    const confidence = Math.max(point.confidence ?? 0, best?.score ?? 0)
    const ambiguous = Boolean(best && second && best.score - second.score < 0.08)

    resolved.push({
      raw: point.raw,
      name: best?.name ?? point.name ?? point.raw,
      lat: best?.lat ?? null,
      lon: best?.lon ?? null,
      notes: point.notes ?? null,
      estimatedCoordinate: Boolean(point.estimatedCoordinate),
      confidence,
      status: best ? ambiguous ? 'ambiguous' : 'resolved' : 'unresolved',
      source: best?.source ?? 'Saknar träff',
      candidates,
    })
  }

  return resolved
}

export function createFlightPlanFromImportedRoute(routeName: string, points: ResolvedRouteImportWaypoint[]): FlightPlanInput {
  const waypoints: RoutePointInput[] = points
    .filter((point) => point.lat != null && point.lon != null)
    .map((point) => ({
      name: point.name,
      lat: point.lat!,
      lon: point.lon!,
    }))

  const plan = createEmptyFlightPlan()
  const first = waypoints[0]
  const last = waypoints[waypoints.length - 1]

  return {
    ...plan,
    header: {
      ...plan.header,
      departureAerodrome: first?.name.split(' ')[0] ?? '',
      destinationAerodrome: last?.name.split(' ')[0] ?? '',
    },
    routeLegs: waypointsToLegs(waypoints, [], DEFAULT_ROUTE_TAS_KT),
    radioNav: plan.radioNav.map((entry, index) => index === 0
      ? { ...entry, name: routeName || 'Importerad rutt' }
      : entry),
  }
}
