import { useSyncExternalStore } from 'react'
import type { RoutePointInput, RouteLegInput } from './types'
import { getSwedishAirports } from './aviationData'
import { formatCoordinateDms, snapCoordinate } from './coordinates'

type AirportEntry = {
  icao: string
  name: string
  lat: number
  lon: number
}

const earthRadiusNm = 3440.065
const airportDisplayToleranceNm = 0.15
const highResolutionSearchRadiusNm = 2.2
const placeSearchRadiusNmByKind = {
  settlement: 8,
  lake: 6,
  water: 5,
  island: 5,
  mountain: 4,
} as const
const kindPreference = {
  settlement: 0.92,
  lake: 1,
  water: 0.96,
  island: 0.98,
  mountain: 0.98,
} as const
const placesDataUrl = `${import.meta.env.BASE_URL}vfrplan-data/places.se.json`

type SwedishPlaceKind = keyof typeof placeSearchRadiusNmByKind

type SwedishPlace = {
  name: string
  lat: number
  lon: number
  kind: SwedishPlaceKind
  importance: number
}

type CompactSwedishPlace = [string, number, number, 's' | 'l' | 'w' | 'i' | 'm', number]

let swedishPlaces: SwedishPlace[] = []
let placesVersion = 0
let placesLoadPromise: Promise<void> | null = null
const placeSubscribers = new Set<() => void>()

function degToRad(value: number) {
  return (value * Math.PI) / 180
}

function distanceNm(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const lat1 = degToRad(fromLat)
  const lat2 = degToRad(toLat)
  const dLat = degToRad(toLat - fromLat)
  const dLon = degToRad(toLon - fromLon)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatCoordinateLabel(lat: number, lon: number) {
  return `${formatCoordinateDms(lat, 'lat')} ${formatCoordinateDms(lon, 'lon')}`
}

function notifyPlacesUpdated() {
  placesVersion += 1
  for (const subscriber of placeSubscribers) {
    subscriber()
  }
}

function getAirportEntries(): AirportEntry[] {
  return getSwedishAirports()
    .filter((airport) => airport.name && airport.icao)
    .map((airport) => ({
      icao: airport.icao!,
      name: `${airport.name}`,
      lat: airport.lat,
      lon: airport.lon,
    }))
}

function expandPlaceKind(kindCode: CompactSwedishPlace[3]): SwedishPlaceKind {
  switch (kindCode) {
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
  }
}

export function preloadSwedishPlaces() {
  if (swedishPlaces.length > 0 || placesLoadPromise) {
    return placesLoadPromise ?? Promise.resolve()
  }

  placesLoadPromise = fetch(placesDataUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to load place gazetteer (${response.status})`)
      }

      const nextPlaces = await response.json()
      if (!Array.isArray(nextPlaces)) {
        throw new Error('Invalid place gazetteer payload')
      }

      swedishPlaces = nextPlaces.map((place) => {
        const [name, lat, lon, kindCode, importance] = place as CompactSwedishPlace
        return {
          name,
          lat,
          lon,
          kind: expandPlaceKind(kindCode),
          importance,
        }
      })
      notifyPlacesUpdated()
    })
    .catch((error) => {
      console.error(error)
    })
    .finally(() => {
      placesLoadPromise = null
    })

  return placesLoadPromise
}

export function useGazetteerVersion() {
  preloadSwedishPlaces()
  return useSyncExternalStore(
    (onStoreChange) => {
      placeSubscribers.add(onStoreChange)
      return () => placeSubscribers.delete(onStoreChange)
    },
    () => placesVersion,
    () => placesVersion,
  )
}

function findNearestAirport(lat: number, lon: number) {
  const airports = getAirportEntries()
  let nearest = airports[0]
  let minDistance = Number.POSITIVE_INFINITY

  for (const place of airports) {
    const distance = distanceNm(lat, lon, place.lat, place.lon)
    if (distance < minDistance) {
      minDistance = distance
      nearest = place
    }
  }

  return {
    airport: nearest,
    distanceNm: minDistance,
  }
}

function findBestNamedPlace(lat: number, lon: number) {
  if (swedishPlaces.length === 0) {
    return null
  }

  let nearestMatch = null
  let nearestDistance = Number.POSITIVE_INFINITY
  let bestMatch = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const place of swedishPlaces) {
    const distance = distanceNm(lat, lon, place.lat, place.lon)
    const maxDistance = placeSearchRadiusNmByKind[place.kind]
    if (distance > maxDistance) {
      continue
    }

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestMatch = {
        place,
        distanceNm: distance,
      }
    }

    const normalizedDistance = 1 - distance / maxDistance
    const score = normalizedDistance * 0.7 + place.importance * 0.2 + kindPreference[place.kind] * 0.1

    if (score > bestScore) {
      bestScore = score
      bestMatch = {
        place,
        distanceNm: distance,
        score,
      }
    }
  }

  if (nearestMatch && nearestMatch.distanceNm <= highResolutionSearchRadiusNm) {
    return nearestMatch
  }

  return bestMatch
}

export function getRoutePointLabel(point: RoutePointInput) {
  const nearest = findNearestAirport(point.lat, point.lon)
  if (nearest.distanceNm <= airportDisplayToleranceNm) {
    return nearest.airport.icao
  }

  const nearbyPlace = findBestNamedPlace(point.lat, point.lon)
  if (nearbyPlace) {
    return nearbyPlace.place.name
  }

  return formatCoordinateLabel(point.lat, point.lon)
}

export function legsToWaypoints(legs: RouteLegInput[]): RoutePointInput[] {
  if (legs.length === 0) {
    return []
  }

  return [legs[0].from, ...legs.map((leg) => leg.to)]
}

export function waypointsToLegs(
  waypoints: RoutePointInput[],
  previousLegs: RouteLegInput[],
  defaultTasKt: number,
): RouteLegInput[] {
  if (waypoints.length < 2) {
    return previousLegs
  }

  return waypoints.slice(0, -1).map((from, index) => {
    const previous = previousLegs[index] ?? previousLegs[index - 1] ?? previousLegs[0]
    return {
      from,
      to: waypoints[index + 1],
      windDirection: previous?.windDirection ?? 220,
      windSpeedKt: previous?.windSpeedKt ?? 15,
      tasKt: previous?.tasKt ?? defaultTasKt,
      variation: previous?.variation ?? 6,
      altitude: previous?.altitude ?? "3000'",
      navRef: previous?.navRef ?? '',
      notes: previous?.notes ?? '',
    }
  })
}

export function pointWithNearestName(lat: number, lon: number): RoutePointInput {
  const snappedLat = snapCoordinate(lat)
  const snappedLon = snapCoordinate(lon)

  return {
    lat: snappedLat,
    lon: snappedLon,
    name: formatCoordinateLabel(snappedLat, snappedLon),
  }
}
