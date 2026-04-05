import { swedishNavaids } from './generated/radio-nav.se'
import type { NearbyAirport } from './weather'
import type { FlightPlanInput } from './types'
import type { NotamSupplement } from './notam'

const earthRadiusNm = 3440.065

type RoutePoint = {
  lat: number
  lon: number
}

export type RouteNotamMatch = {
  id: string
  title: string
  rawText: string
  distanceNm: number
  progressNm: number
  matchSummary: string
  matchedNavaids: string[]
  supplementIds: string[]
}

export type RelevantNotamSupplement = NotamSupplement & {
  relevance: string
}

function degToRad(value: number) {
  return (value * Math.PI) / 180
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
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

function toLocalNm(lat: number, lon: number, referenceLat: number) {
  return {
    x: lon * 60 * Math.cos(degToRad(referenceLat)),
    y: lat * 60,
  }
}

function pointToSegmentDistance(point: RoutePoint, start: RoutePoint, end: RoutePoint) {
  const referenceLat = (point.lat + start.lat + end.lat) / 3
  const pointNm = toLocalNm(point.lat, point.lon, referenceLat)
  const startNm = toLocalNm(start.lat, start.lon, referenceLat)
  const endNm = toLocalNm(end.lat, end.lon, referenceLat)
  const segmentX = endNm.x - startNm.x
  const segmentY = endNm.y - startNm.y
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2

  if (segmentLengthSquared < 1e-9) {
    return {
      lateralDistanceNm: distanceNm(point.lat, point.lon, start.lat, start.lon),
      alongFraction: 0,
    }
  }

  const projection =
    ((pointNm.x - startNm.x) * segmentX + (pointNm.y - startNm.y) * segmentY) /
    segmentLengthSquared
  const alongFraction = Math.max(0, Math.min(1, projection))
  const closestX = startNm.x + alongFraction * segmentX
  const closestY = startNm.y + alongFraction * segmentY

  return {
    lateralDistanceNm: Math.hypot(pointNm.x - closestX, pointNm.y - closestY),
    alongFraction,
  }
}

function routeDistanceForPoint(routeLegs: FlightPlanInput['routeLegs'], point: RoutePoint) {
  let bestDistanceNm = Number.POSITIVE_INFINITY
  let bestProgressNm = Number.POSITIVE_INFINITY
  let distanceBeforeLegNm = 0

  for (const leg of routeLegs) {
    const legLengthNm = distanceNm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon)
    const projection = pointToSegmentDistance(point, leg.from, leg.to)
    const progressNm = distanceBeforeLegNm + projection.alongFraction * legLengthNm

    if (
      projection.lateralDistanceNm < bestDistanceNm ||
      (Math.abs(projection.lateralDistanceNm - bestDistanceNm) < 0.05 && progressNm < bestProgressNm)
    ) {
      bestDistanceNm = projection.lateralDistanceNm
      bestProgressNm = progressNm
    }

    distanceBeforeLegNm += legLengthNm
  }

  return {
    distanceNm: round(bestDistanceNm),
    progressNm: round(bestProgressNm),
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function parseCoordinateComponent(value: string, degreeDigits: number) {
  const hemisphere = value.slice(-1)
  const numeric = value.slice(0, -1)
  const degrees = Number(numeric.slice(0, degreeDigits))
  const minutes = Number(numeric.slice(degreeDigits, degreeDigits + 2))
  const seconds = Number(numeric.slice(degreeDigits + 2))
  const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
  return sign * (degrees + minutes / 60 + seconds / 3600)
}

function extractCoordinates(rawText: string) {
  const matches = rawText.matchAll(/(\d{6}(?:\.\d+)?[NS])\s*(\d{7}(?:\.\d+)?[EW])/gi)

  return Array.from(matches, ([, latValue, lonValue]) => ({
    lat: parseCoordinateComponent(latValue.toUpperCase(), 2),
    lon: parseCoordinateComponent(lonValue.toUpperCase(), 3),
  }))
}

function splitSectionEntries(sectionText: string | null) {
  if (!sectionText) {
    return []
  }

  return sectionText
    .split(/\s+\+\s+/g)
    .map((entry) => entry.replace(/^\+\s*/, '').trim())
    .filter(Boolean)
}

function deriveTitle(rawText: string) {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  const timestampIndex = normalized.search(/\d{2}\s+[A-Z]{3}\s+\d{4}/)
  const source = timestampIndex > 15 ? normalized.slice(0, timestampIndex).trim() : normalized
  return source.length > 140 ? `${source.slice(0, 137)}...` : source
}

function extractSupplementIds(rawText: string) {
  return Array.from(new Set(
    [...rawText.matchAll(/\bAIP\s+SUP\s+(\d+\/\d{4})\b/gi)].map((match) => match[1]),
  ))
}

function centroid(points: RoutePoint[]) {
  if (points.length === 0) {
    return null
  }

  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
  }
}

export function getRouteNotamMatches(
  routeLegs: FlightPlanInput['routeLegs'],
  sectionText: string | null,
  maxDistanceNm = 50,
): RouteNotamMatch[] {
  if (routeLegs.length === 0 || !sectionText) {
    return []
  }

  return splitSectionEntries(sectionText)
    .map((entry, index) => {
      const coordinates = extractCoordinates(entry)
      const coordinateDistances = coordinates.map((point) => routeDistanceForPoint(routeLegs, point))
      const areaCenter = coordinates.length >= 2 ? centroid(coordinates) : null

      if (areaCenter) {
        coordinateDistances.push(routeDistanceForPoint(routeLegs, areaCenter))
      }

      const normalizedEntry = ` ${normalizeForMatch(entry)} `
      const matchedNavaids = swedishNavaids
        .map((navaid) => {
          const ident = navaid.ident ? normalizeForMatch(navaid.ident) : null
          const name = navaid.name ? normalizeForMatch(navaid.name) : null
          const identHit = ident ? new RegExp(`[^A-Z0-9]${escapeRegExp(ident)}[^A-Z0-9]`).test(normalizedEntry) : false
          const nameHit = name && name.length >= 5
            ? new RegExp(`[^A-Z0-9]${escapeRegExp(name)}[^A-Z0-9]`).test(normalizedEntry)
            : false

          if (!identHit && !nameHit) {
            return null
          }

          const distance = routeDistanceForPoint(routeLegs, { lat: navaid.lat, lon: navaid.lon })
          if (distance.distanceNm > maxDistanceNm) {
            return null
          }

          return {
            label: navaid.ident ? `${navaid.ident}${navaid.name ? `/${navaid.name}` : ''}` : (navaid.name ?? navaid.id),
            distanceNm: distance.distanceNm,
            progressNm: distance.progressNm,
          }
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((left, right) => left.distanceNm - right.distanceNm || left.label.localeCompare(right.label, 'sv'))

      const closestCoordinate = coordinateDistances.reduce<null | { distanceNm: number; progressNm: number }>(
        (closest, current) =>
          !closest || current.distanceNm < closest.distanceNm ? current : closest,
        null,
      )
      const closestNavaid = matchedNavaids[0]
      const bestDistance =
        closestCoordinate && closestNavaid
          ? closestCoordinate.distanceNm <= closestNavaid.distanceNm
            ? closestCoordinate
            : closestNavaid
          : closestCoordinate ?? closestNavaid

      if (!bestDistance || bestDistance.distanceNm > maxDistanceNm) {
        return null
      }

      const summaryParts: string[] = []

      if (coordinates.length > 0) {
        summaryParts.push(
          coordinates.length === 1
            ? `PSN ${round(bestDistance.distanceNm)} NM från rutten`
            : `${coordinates.length} koordinater/area, närmast ${round(bestDistance.distanceNm)} NM`,
        )
      }

      if (matchedNavaids.length > 0) {
        summaryParts.push(`Navaid ${matchedNavaids.map((navaid) => navaid.label).join(', ')}`)
      }

      return {
        id: `${index}-${deriveTitle(entry)}`,
        title: deriveTitle(entry),
        rawText: entry,
        distanceNm: bestDistance.distanceNm,
        progressNm: bestDistance.progressNm,
        matchSummary: summaryParts.join(' · ') || `Närmast ${round(bestDistance.distanceNm)} NM från rutten`,
        matchedNavaids: matchedNavaids.map((navaid) => navaid.label),
        supplementIds: extractSupplementIds(entry),
      }
    })
    .filter((value): value is RouteNotamMatch => Boolean(value))
    .sort((left, right) => left.progressNm - right.progressNm || left.distanceNm - right.distanceNm)
}

export function getRelevantSupplements(
  supplements: NotamSupplement[],
  matches: RouteNotamMatch[],
  nearbyAirports: NearbyAirport[],
) {
  const airportKeys = new Set<string>()
  const navaidKeys = new Set<string>()
  const routeSupplementIds = new Set(matches.flatMap((match) => match.supplementIds))

  for (const airport of nearbyAirports) {
    airportKeys.add(airport.icao.toUpperCase())
    airportKeys.add(normalizeForMatch(airport.name))
  }

  for (const match of matches) {
    for (const navaid of match.matchedNavaids) {
      navaidKeys.add(normalizeForMatch(navaid))
    }
  }

  return supplements
    .map((supplement) => {
      if (routeSupplementIds.has(supplement.id)) {
        return {
          ...supplement,
          relevance: 'Refererad i route-relevant NOTAM/NAV warning',
        }
      }

      const normalizedTitle = normalizeForMatch(supplement.title)
      const airportHit = Array.from(airportKeys).find((key) => key && normalizedTitle.includes(key))
      if (airportHit) {
        return {
          ...supplement,
          relevance: 'Matchar flygplats nära färdlinjen',
        }
      }

      const navaidHit = Array.from(navaidKeys).find((key) => key && normalizedTitle.includes(key))
      if (navaidHit) {
        return {
          ...supplement,
          relevance: 'Matchar navaid nära färdlinjen',
        }
      }

      return null
    })
    .filter((value): value is RelevantNotamSupplement => Boolean(value))
    .sort((left, right) => left.id.localeCompare(right.id, 'sv'))
}
