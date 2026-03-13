import type { RoutePointInput, RouteLegInput } from './types'
import { swedishAirports } from './generated/airports.se'

type GazetteerEntry = {
  name: string
  lat: number
  lon: number
}

const places: GazetteerEntry[] = swedishAirports
  .filter((airport) => airport.name && airport.icao)
  .map((airport) => ({
    name: `${airport.name}`,
    lat: airport.lat,
    lon: airport.lon,
  }))

const earthRadiusNm = 3440.065

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
  const latHemisphere = lat >= 0 ? 'N' : 'S'
  const lonHemisphere = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(3)}${latHemisphere} ${Math.abs(lon).toFixed(3)}${lonHemisphere}`
}

export function nearestPlaceLabel(lat: number, lon: number) {
  let nearest = places[0]
  let minDistance = Number.POSITIVE_INFINITY

  for (const place of places) {
    const distance = distanceNm(lat, lon, place.lat, place.lon)
    if (distance < minDistance) {
      minDistance = distance
      nearest = place
    }
  }

  if (minDistance <= 18) {
    return nearest.name
  }

  return formatCoordinateLabel(lat, lon)
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
      altitude: previous?.altitude ?? '',
      navRef: previous?.navRef ?? '',
      notes: previous?.notes ?? '',
    }
  })
}

export function pointWithNearestName(lat: number, lon: number): RoutePointInput {
  return {
    lat,
    lon,
    name: nearestPlaceLabel(lat, lon),
  }
}
