import { getSwedishNavaids } from './aviationData'
import type { NearbyAirport } from './weather'
import type { FlightPlanInput } from './types'
import type { NotamSupplement } from './notam'

const earthRadiusNm = 3440.065

type RoutePoint = {
  lat: number
  lon: number
}

type RouteDistance = {
  distanceNm: number
  progressNm: number
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
  distanceNm: number | null
  progressNm: number | null
  hasGeometry: boolean
}

function normalizeDisplayText(value: string) {
  return value
    .replace(/\s*–\s*/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeNotamSourceText(value: string) {
  const withoutHtml = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/if\s*\(isIE\(\)\s*\|\|\s*isChrome\(\)\)\s*\{[\s\S]*?\}/gi, ' ')
    .replace(/setActiveStyleSheet\([^)]*\);?/gi, ' ')
    .replace(/setRequestedStyleSheet\([^)]*\);?/gi, ' ')
    .replace(/hide_amdts_ss/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (/AIP SUPPLEMENT SWEDEN/i.test(withoutHtml)) {
    return withoutHtml.replace(/^.*?(AIP SUPPLEMENT SWEDEN\b)/i, '$1').trim()
  }

  return withoutHtml
}

export function formatNotamText(value: string | null) {
  if (!value) {
    return ''
  }

  return sanitizeNotamSourceText(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\+\s+/g, '\n\n+ ')
    .replace(/^(\+\s+)/, '+ ')
    .replace(/(\d{2}:\d{2})(FROM:)/g, '$1\nFROM:')
    .replace(/(\d{2}:\d{2})(TO:)/g, '$1\nTO:')
    .replace(/(EST)(TO:)/g, '$1\nTO:')
    .replace(/\s+(FROM:)/g, '\n$1')
    .replace(/\s+(TO:)/g, '\n$1')
    .replace(/\s+(LOWER:)/g, '\n$1')
    .replace(/\s+(UPPER:)/g, '\n$1')
    .replace(/\s+(Tider\/Hours)/g, '\n$1')
    .replace(/\s+(AREA BOUNDED BY:)/g, '\n$1')
    .replace(/\s+(WI A CIRCLE WITH RADIUS)/g, '\n$1')
    .replace(/\s+(CENTERED ON|CENTRED ON)/g, '\n$1')
    .replace(/\s+(FLIGHT WI THE AREA)/g, '\n$1')
    .replace(/\s+(The following traffic on mission is exempted)/g, '\n$1')
    .replace(/\s+(The following traffic is exempted)/g, '\n$1')
    .replace(/\s+([•-])\s+/g, '\n$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function routeDistanceForPoint(routeLegs: FlightPlanInput['routeLegs'], point: RoutePoint): RouteDistance {
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
  const normalized = rawText.replace(/\u00a0/g, ' ')

  const pairs: RoutePoint[] = []
  const pushPair = (latValue: string, lonValue: string) => {
    pairs.push({
      lat: parseCoordinateComponent(latValue.toUpperCase(), 2),
      lon: parseCoordinateComponent(lonValue.toUpperCase(), 3),
    })
  }

  const withSpace = [...normalized.matchAll(/(\d{6}(?:\.\d+)?[NS])\s+(\d{7}(?:\.\d+)?[EW])/gi)]
  for (const match of withSpace) {
    if (match[1] && match[2]) {
      pushPair(match[1], match[2])
    }
  }

  if (pairs.length === 0) {
    const glued = [...normalized.matchAll(/(\d{6}(?:\.\d+)?[NS])(\d{7}(?:\.\d+)?[EW])/gi)]
    for (const match of glued) {
      if (match[1] && match[2]) {
        pushPair(match[1], match[2])
      }
    }
  }

  if (pairs.length === 0) {
    const short = [...normalized.matchAll(/(\d{4}(?:\.\d+)?[NS])\s+(\d{5}(?:\.\d+)?[EW])/gi)]
    for (const match of short) {
      if (match[1] && match[2]) {
        pushPair(match[1], match[2])
      }
    }
  }

  return pairs
}

function dedupeCoordinates(points: RoutePoint[]) {
  const deduped: RoutePoint[] = []

  for (const point of points) {
    const exists = deduped.some((candidate) => (
      Math.abs(candidate.lat - point.lat) < 1e-7 &&
      Math.abs(candidate.lon - point.lon) < 1e-7
    ))

    if (!exists) {
      deduped.push(point)
    }
  }

  return deduped
}

function splitSectionEntries(sectionText: string | null) {
  if (!sectionText) {
    return []
  }

  const normalized = sectionText.replace(/\u00a0/g, ' ')
  const bySpacedPlus = normalized
    .split(/\s+\+\s+/g)
    .map((entry) => entry.replace(/^\+\s*/, '').trim())
    .filter(Boolean)

  if (bySpacedPlus.length > 1) {
    return bySpacedPlus
  }

  const byLinePlus = normalized
    .split(/\n\s*\+\s*/g)
    .map((entry) => entry.replace(/^\+\s*/, '').trim())
    .filter(Boolean)

  if (byLinePlus.length > 1) {
    return byLinePlus
  }

  return bySpacedPlus.length > 0 ? bySpacedPlus : byLinePlus
}

function deriveTitle(rawText: string) {
  const normalized = sanitizeNotamSourceText(rawText).replace(/\s+/g, ' ').trim()
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

function isClosedPolygon(points: RoutePoint[], rawText: string) {
  if (points.length < 3) {
    return false
  }

  if (/AREA\s+BOUNDED\s+BY|POLYGON/i.test(rawText)) {
    return true
  }

  const first = points[0]
  const last = points[points.length - 1]
  return distanceNm(first.lat, first.lon, last.lat, last.lon) <= 0.2
}

function pointInRing(lat: number, lon: number, ring: RoutePoint[]) {
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon
    const yi = ring[i].lat
    const xj = ring[j].lon
    const yj = ring[j].lat
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function orientation(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) <= 1e-9) {
    return 0
  }
  return value > 0 ? 1 : 2
}

function onSegment(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return (
    b.x <= Math.max(a.x, c.x) + 1e-9 &&
    b.x + 1e-9 >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) + 1e-9 &&
    b.y + 1e-9 >= Math.min(a.y, c.y)
  )
}

function segmentsIntersect(startA: RoutePoint, endA: RoutePoint, startB: RoutePoint, endB: RoutePoint) {
  const referenceLat = (startA.lat + endA.lat + startB.lat + endB.lat) / 4
  const a = toLocalNm(startA.lat, startA.lon, referenceLat)
  const b = toLocalNm(endA.lat, endA.lon, referenceLat)
  const c = toLocalNm(startB.lat, startB.lon, referenceLat)
  const d = toLocalNm(endB.lat, endB.lon, referenceLat)

  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 !== o2 && o3 !== o4) {
    return true
  }

  if (o1 === 0 && onSegment(a, c, b)) {
    return true
  }
  if (o2 === 0 && onSegment(a, d, b)) {
    return true
  }
  if (o3 === 0 && onSegment(c, a, d)) {
    return true
  }
  if (o4 === 0 && onSegment(c, b, d)) {
    return true
  }

  return false
}

function routeIntersectsPolygon(routeLegs: FlightPlanInput['routeLegs'], polygon: RoutePoint[]) {
  for (const leg of routeLegs) {
    if (pointInRing(leg.from.lat, leg.from.lon, polygon) || pointInRing(leg.to.lat, leg.to.lon, polygon)) {
      return routeDistanceForPoint(routeLegs, leg.from)
    }

    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index]
      const next = polygon[(index + 1) % polygon.length]
      if (segmentsIntersect(leg.from, leg.to, current, next)) {
        return {
          distanceNm: 0,
          progressNm: routeDistanceForPoint(routeLegs, leg.from).progressNm,
        }
      }
    }
  }

  return null
}

function matchNearbyNavaids(routeLegs: FlightPlanInput['routeLegs'], rawText: string, maxDistanceNm: number) {
  const normalizedEntry = ` ${normalizeForMatch(rawText)} `

  return getSwedishNavaids()
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
}

function getBestGeometryMatch(routeLegs: FlightPlanInput['routeLegs'], rawText: string) {
  const coordinates = extractCoordinates(rawText)
  const polygon = isClosedPolygon(coordinates, rawText) ? coordinates.slice(0, -1) : null
  const polygonIntersection = polygon && polygon.length >= 3 ? routeIntersectsPolygon(routeLegs, polygon) : null

  if (polygonIntersection) {
    return {
      coordinates,
      bestDistance: polygonIntersection,
    }
  }

  const coordinateDistances = coordinates.map((point) => routeDistanceForPoint(routeLegs, point))
  const areaCenter = coordinates.length >= 2 ? centroid(coordinates) : null

  if (areaCenter) {
    coordinateDistances.push(routeDistanceForPoint(routeLegs, areaCenter))
  }

  const bestDistance = coordinateDistances.reduce<RouteDistance | null>(
    (closest, current) => (!closest || current.distanceNm < closest.distanceNm ? current : closest),
    null,
  )

  return {
    coordinates,
    bestDistance,
  }
}

function parseIsoDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`) : null
}

export function getSupplementValidityLabel(supplement: NotamSupplement) {
  const rawText = supplement.rawText ?? ''
  const hoursMatch = rawText.match(/Tider\/Hours\s+(.+?)(?:\s+–\s*S L U T\s*\/\s*E N D\s*–|$)/i)

  if (hoursMatch?.[1]) {
    return normalizeDisplayText(hoursMatch[1])
  }

  return supplement.periodText ? normalizeDisplayText(supplement.periodText) : 'Giltighet okänd'
}

export function getSupplementSourceLabel(supplement: NotamSupplement) {
  return supplement.source === 'eaip-datasource' ? 'LFV eSUP' : 'NOTAM-referens'
}

function isSupplementValidOnDate(supplement: NotamSupplement, flightDate: string) {
  if (!flightDate) {
    return true
  }

  const flight = parseIsoDate(flightDate)
  const validFrom = parseIsoDate(supplement.validFrom)
  const validTo = parseIsoDate(supplement.validTo)

  if (!flight) {
    return true
  }

  if (validFrom && flight < validFrom) {
    return false
  }

  if (validTo && flight > validTo) {
    return false
  }

  return true
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
      const geometry = getBestGeometryMatch(routeLegs, entry)
      const matchedNavaids = matchNearbyNavaids(routeLegs, entry, maxDistanceNm)
      const closestNavaid = matchedNavaids[0]
      const bestDistance =
        geometry.bestDistance && closestNavaid
          ? geometry.bestDistance.distanceNm <= closestNavaid.distanceNm
            ? geometry.bestDistance
            : closestNavaid
          : geometry.bestDistance ?? closestNavaid

      if (!bestDistance || bestDistance.distanceNm > maxDistanceNm) {
        return null
      }

      const summaryParts: string[] = []

      if (geometry.coordinates.length > 0) {
        summaryParts.push(
          geometry.coordinates.length === 1
            ? `PSN ${round(bestDistance.distanceNm)} NM från rutten`
            : `${geometry.coordinates.length} koordinater/area, närmast ${round(bestDistance.distanceNm)} NM`,
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
  routeLegs: FlightPlanInput['routeLegs'],
  flightDate: string,
  supplements: NotamSupplement[],
  matches: RouteNotamMatch[],
  nearbyAirports: NearbyAirport[],
  maxDistanceNm = 50,
) {
  if (routeLegs.length === 0) {
    return []
  }

  const routeSupplementIds = new Set(matches.flatMap((match) => match.supplementIds))
  const airportKeys = new Set<string>()

  for (const airport of nearbyAirports) {
    airportKeys.add(airport.icao.toUpperCase())
    airportKeys.add(normalizeForMatch(airport.name))
  }

  return supplements
    .filter((supplement) => isSupplementValidOnDate(supplement, flightDate))
    .map((supplement) => {
      const rawText = supplement.rawText ?? supplement.title
      const geometry = getBestGeometryMatch(routeLegs, rawText)
      const hasGeometry = geometry.coordinates.length > 0
      const bestDistance = geometry.bestDistance

      if (routeSupplementIds.has(supplement.id)) {
        return {
          ...supplement,
          relevance: 'Refererad i route-relevant NOTAM/NAV warning',
          distanceNm: bestDistance?.distanceNm ?? null,
          progressNm: bestDistance?.progressNm ?? null,
          hasGeometry,
        }
      }

      if (bestDistance && bestDistance.distanceNm <= maxDistanceNm) {
        return {
          ...supplement,
          relevance: hasGeometry ? 'SUP-område inom 50 NM från färdlinjen' : 'SUP-referens nära rutten',
          distanceNm: bestDistance.distanceNm,
          progressNm: bestDistance.progressNm,
          hasGeometry,
        }
      }

      const normalizedTitle = normalizeForMatch(supplement.title)
      const airportHit = Array.from(airportKeys).find((key) => key && normalizedTitle.includes(key))
      if (airportHit) {
        return {
          ...supplement,
          relevance: 'Giltig på flygdatum och matchar flygplats nära färdlinjen',
          distanceNm: null,
          progressNm: null,
          hasGeometry,
        }
      }

      return null
    })
    .filter((value): value is RelevantNotamSupplement => Boolean(value))
    .sort((left, right) => {
      const leftDistance = left.distanceNm ?? Number.POSITIVE_INFINITY
      const rightDistance = right.distanceNm ?? Number.POSITIVE_INFINITY
      return leftDistance - rightDistance || left.id.localeCompare(right.id, 'sv')
    })
}

/** Kartvisualisering: en-route, NAV-varningar och AIP SUP med koordinater i text. */
export type NotamMapGeometryKind = 'point' | 'polyline' | 'polygon' | 'circle'

export type NotamMapOverlayFeature = {
  id: string
  source: 'notam-enroute' | 'notam-warning' | 'aip-sup'
  label: string
  title: string
  rawText: string
  kind: NotamMapGeometryKind
  positions: [number, number][]
  radiusNm?: number
  supplementId?: string
  supplementUrl?: string | null
}

function extractCircleRadiusNm(rawText: string): number | null {
  const normalized = rawText.replace(/\s+/g, ' ')
  const patterns = [
    /(?:WI\s+A\s+)?CIRCLE\s+WITH\s+RADIUS\s+(\d+(?:\.\d+)?)\s*NM/i,
    /(?:EN\s+)?CIRKEL\s+MED\s+RADIE\s+(\d+(?:\.\d+)?)\s*NM/i,
    /INOM\s+EN\s+RADIE\s+AV\s+(\d+(?:\.\d+)?)\s*NM/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (!match) {
      continue
    }

    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0) {
      return value
    }
  }

  return null
}

function polygonRingFromCoordinates(points: RoutePoint[], rawText: string): RoutePoint[] | null {
  if (!isClosedPolygon(points, rawText)) {
    return null
  }

  if (points.length < 3) {
    return null
  }

  const first = points[0]
  const last = points[points.length - 1]
  if (distanceNm(first.lat, first.lon, last.lat, last.lon) <= 0.2) {
    return points.slice(0, -1)
  }

  return points
}

function shouldRenderAsPolyline(rawText: string, points: RoutePoint[]) {
  if (points.length < 2) {
    return false
  }

  const normalized = rawText.replace(/\s+/g, ' ').toUpperCase()

  if (/AREA\s+BOUNDED\s+BY|POLYGON|CIRCLE\s+WITH\s+RADIUS/.test(normalized)) {
    return false
  }

  if (
    /(?:ALONG|TRACK|ROUTE|AIRWAY|AWY|CENTER LINE|CENTRE LINE|BETWEEN|FROM:| TO:| FROM | TO | JOINING|LINE\b)/.test(
      normalized,
    )
  ) {
    return true
  }

  return false
}

function pushPointFeatures(
  features: NotamMapOverlayFeature[],
  coords: RoutePoint[],
  rawText: string,
  source: NotamMapOverlayFeature['source'],
  idPrefix: string,
  supplementMeta?: { id: string; url: string | null },
) {
  for (const [index, point] of coords.entries()) {
    features.push({
      id: `${idPrefix}-pt-${index}`,
      source,
      label: notamMapSourceLabel(source),
      title: deriveTitle(rawText),
      rawText,
      kind: 'point',
      positions: [[point.lat, point.lon]],
      supplementId: supplementMeta?.id,
      supplementUrl: supplementMeta?.url,
    })
  }
}

function splitSupplementGeometrySections(rawText: string) {
  const normalized = rawText.replace(/\u00a0/g, ' ').trim()
  const sectionStarts = new Map<number, string>()
  const codedHeadingPattern = /\b([A-Z]{2,4}\d{3,4}[A-Z]?\s+[A-ZÅÄÖ0-9][A-ZÅÄÖ0-9 /-]*?(?:UAS|TRA|TSA|CTR|TMA|RMZ|TMZ))\b/g
  const plainHeadingPattern = /(?:^|\n)\s*([A-ZÅÄÖ][A-ZÅÄÖ0-9 /-]{2,})(?=\s*\n\s*\d+\.\s*OBST)/g
  const obstacleHeadingPattern = /\b([A-ZÅÄÖ][A-ZÅÄÖ0-9 /-]{2,})\s+(?=\d+\.\s*OBST\b)/g

  for (const match of normalized.matchAll(codedHeadingPattern)) {
    const start = match.index ?? 0
    const preview = normalized.slice(start, Math.min(normalized.length, start + 260))
    if (/(?:VERTICAL\s+LIMITS|GRÄNS\s+I\s+HÖJDLED|PSN|INOM\s+EN\s+RADIE)/i.test(preview)) {
      sectionStarts.set(start, match[1])
    }
  }

  for (const match of normalized.matchAll(plainHeadingPattern)) {
    const start = match.index ?? 0
    const heading = match[1]?.trim() ?? ''
    if (heading.length < 3 || heading.length > 80) {
      continue
    }

    const preview = normalized.slice(start, Math.min(normalized.length, start + 260))
    if (/(?:PSN|INOM\s+EN\s+RADIE)/i.test(preview)) {
      sectionStarts.set(start, heading)
    }
  }

  for (const match of normalized.matchAll(obstacleHeadingPattern)) {
    const start = match.index ?? 0
    const heading = match[1]?.trim() ?? ''
    if (heading.length < 3 || heading.length > 80) {
      continue
    }

    const preview = normalized.slice(start, Math.min(normalized.length, start + 260))
    if (/\d+\.\s*OBST\b/i.test(preview) && /(?:PSN|INOM\s+EN\s+RADIE)/i.test(preview)) {
      sectionStarts.set(start, heading)
    }
  }

  const matches = [...sectionStarts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, heading]) => ({ index, heading }))

  if (matches.length === 0) {
    return [normalized]
  }

  const sections: string[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const start = match.index
    const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length
    const section = normalized.slice(start, end).trim()
    if (extractCoordinates(section).length > 0) {
      sections.push(section)
    }
  }

  return sections.length > 0 ? sections : [normalized]
}

function notamMapSourceLabel(source: NotamMapOverlayFeature['source']) {
  if (source === 'notam-enroute') {
    return 'En-route NOTAM'
  }

  if (source === 'notam-warning') {
    return 'NAV-varning'
  }

  return 'AIP SUP'
}

function pushGeometryFromCoordinateText(
  features: NotamMapOverlayFeature[],
  rawText: string,
  source: NotamMapOverlayFeature['source'],
  idPrefix: string,
  supplementMeta?: { id: string; url: string | null },
) {
  const coords = dedupeCoordinates(extractCoordinates(rawText))
  if (coords.length === 0) {
    return
  }

  const circleRadiusNm = extractCircleRadiusNm(rawText)
  if (coords.length === 1 && circleRadiusNm != null) {
    const [point] = coords
    features.push({
      id: `${idPrefix}-circle`,
      source,
      label: notamMapSourceLabel(source),
      title: deriveTitle(rawText),
      rawText,
      kind: 'circle',
      positions: [[point.lat, point.lon]],
      radiusNm: circleRadiusNm,
      supplementId: supplementMeta?.id,
      supplementUrl: supplementMeta?.url,
    })
    return
  }

  const ring = polygonRingFromCoordinates(coords, rawText)
  if (ring && ring.length >= 3) {
    features.push({
      id: `${idPrefix}-poly`,
      source,
      label: notamMapSourceLabel(source),
      title: deriveTitle(rawText),
      rawText,
      kind: 'polygon',
      positions: ring.map((point) => [point.lat, point.lon] as [number, number]),
      supplementId: supplementMeta?.id,
      supplementUrl: supplementMeta?.url,
    })
    return
  }

  if (coords.length === 1) {
    const [point] = coords
    features.push({
      id: `${idPrefix}-pt`,
      source,
      label: notamMapSourceLabel(source),
      title: deriveTitle(rawText),
      rawText,
      kind: 'point',
      positions: [[point.lat, point.lon]],
      supplementId: supplementMeta?.id,
      supplementUrl: supplementMeta?.url,
    })
    return
  }

  if (!shouldRenderAsPolyline(rawText, coords)) {
    pushPointFeatures(features, coords, rawText, source, idPrefix, supplementMeta)
    return
  }

  features.push({
    id: `${idPrefix}-line`,
    source,
    label: notamMapSourceLabel(source),
    title: deriveTitle(rawText),
    rawText,
    kind: 'polyline',
    positions: coords.map((point) => [point.lat, point.lon] as [number, number]),
    supplementId: supplementMeta?.id,
    supplementUrl: supplementMeta?.url,
  })
}

/**
 * Extraherar alla koordinatbaserade geometrier från LFV-briefing (en-route, NAV-varningar, giltiga AIP SUP).
 */
export function buildNotamMapOverlayFeatures(
  enRouteText: string | null,
  warningsText: string | null,
  supplements: NotamSupplement[],
  flightDate: string,
): NotamMapOverlayFeature[] {
  const features: NotamMapOverlayFeature[] = []

  for (const [index, entry] of splitSectionEntries(enRouteText).entries()) {
    pushGeometryFromCoordinateText(features, entry, 'notam-enroute', `enr-${index}`)
  }

  for (const [index, entry] of splitSectionEntries(warningsText).entries()) {
    pushGeometryFromCoordinateText(features, entry, 'notam-warning', `nav-${index}`)
  }

  for (const supplement of supplements) {
    if (!isSupplementValidOnDate(supplement, flightDate)) {
      continue
    }

    const rawText = supplement.rawText ?? supplement.title
    for (const [index, section] of splitSupplementGeometrySections(rawText).entries()) {
      pushGeometryFromCoordinateText(features, section, 'aip-sup', `sup-${supplement.id}-${index}`, {
        id: supplement.id,
        url: supplement.url,
      })
    }
  }

  return features
}
