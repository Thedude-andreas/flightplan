import type { FlightPlanInput } from './types'

const earthRadiusNm = 3440.065

type RoutePoint = {
  lat: number
  lon: number
}

type RouteDistance = {
  distanceNm: number
  progressNm: number
}

type SegmentProjection = {
  lateralDistanceNm: number
  alongFraction: number
  signedOffsetXNm: number
  signedOffsetYNm: number
}

export type RouteWeatherMatch = {
  id: string
  title: string
  rawText: string
  distanceNm: number
  progressNm: number
  matchSummary: string
  firCodes: string[]
  matchKinds: string[]
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

function pointToSegmentDistance(point: RoutePoint, start: RoutePoint, end: RoutePoint): SegmentProjection {
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
      signedOffsetXNm: pointNm.x - startNm.x,
      signedOffsetYNm: pointNm.y - startNm.y,
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
    signedOffsetXNm: pointNm.x - closestX,
    signedOffsetYNm: pointNm.y - closestY,
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

function routeDistanceToPolyline(routeLegs: FlightPlanInput['routeLegs'], polyline: RoutePoint[]) {
  let bestDistanceNm = Number.POSITIVE_INFINITY
  let bestProgressNm = Number.POSITIVE_INFINITY
  let routeProgressBeforeLegNm = 0

  for (const routeLeg of routeLegs) {
    const routeLegLengthNm = distanceNm(routeLeg.from.lat, routeLeg.from.lon, routeLeg.to.lat, routeLeg.to.lon)

    for (let index = 0; index < polyline.length - 1; index += 1) {
      const projectionFrom = pointToSegmentDistance(routeLeg.from, polyline[index], polyline[index + 1])
      const projectionTo = pointToSegmentDistance(routeLeg.to, polyline[index], polyline[index + 1])
      const bestProjection = projectionFrom.lateralDistanceNm <= projectionTo.lateralDistanceNm ? projectionFrom : projectionTo
      const progressNm = routeProgressBeforeLegNm + (bestProjection === projectionFrom ? 0 : routeLegLengthNm)

      if (
        bestProjection.lateralDistanceNm < bestDistanceNm ||
        (Math.abs(bestProjection.lateralDistanceNm - bestDistanceNm) < 0.05 && progressNm < bestProgressNm)
      ) {
        bestDistanceNm = bestProjection.lateralDistanceNm
        bestProgressNm = progressNm
      }

      if (segmentsIntersect(routeLeg.from, routeLeg.to, polyline[index], polyline[index + 1])) {
        return {
          distanceNm: 0,
          progressNm: routeProgressBeforeLegNm,
        }
      }
    }

    routeProgressBeforeLegNm += routeLegLengthNm
  }

  return {
    distanceNm: round(bestDistanceNm),
    progressNm: round(bestProgressNm),
  }
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

function parseCoordinateComponent(value: string, degreeDigits: number) {
  const hemisphere = value[0]
  const numeric = value.slice(1)
  const degrees = Number(numeric.slice(0, degreeDigits))
  const minutes = numeric.length > degreeDigits ? Number(numeric.slice(degreeDigits)) : 0
  const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
  return sign * (degrees + minutes / 60)
}

function extractCoordinates(rawText: string) {
  const matches = rawText.matchAll(/([NS]\d{2,4})\s*([EW]\d{3,5})/gi)

  return Array.from(matches, ([, latValue, lonValue]) => ({
    lat: parseCoordinateComponent(latValue.toUpperCase(), 2),
    lon: parseCoordinateComponent(lonValue.toUpperCase(), 3),
  }))
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

  if (/\bWI\b|\bAPRX\b/i.test(rawText)) {
    return true
  }

  const first = points[0]
  const last = points[points.length - 1]
  return distanceNm(first.lat, first.lon, last.lat, last.lon) <= 0.2
}

function extractFirCodes(rawText: string) {
  return Array.from(new Set(
    [...rawText.matchAll(/\b([A-Z]{4})-\s*[A-Z]/g)].map((match) => match[1]),
  ))
}

function splitSigmetEntries(sectionText: string | null) {
  if (!sectionText) {
    return []
  }

  const cleaned = sectionText.replace(/^Page\s+\d+\s+of\s+\d+\s+/i, '').trim()
  const starts = [...cleaned.matchAll(/\b([A-Z]{4})\s+(SIGMET|AIRMET|ARS)\b/g)]

  if (starts.length === 0) {
    return []
  }

  return starts
    .map((match, index) => {
      const start = match.index ?? 0
      const end = starts[index + 1]?.index ?? cleaned.length
      return cleaned.slice(start, end).trim()
    })
    .filter(Boolean)
}

function deriveTitle(rawText: string) {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized
}

function extractLineSide(rawText: string) {
  return rawText.match(/\b(N|NE|E|SE|S|SW|W|NW)\s+OF\s+LINE\b/i)?.[1]?.toUpperCase() ?? null
}

function isPointOnRequestedSide(side: string, offsetXNm: number, offsetYNm: number) {
  switch (side) {
    case 'N':
      return offsetYNm >= 0
    case 'S':
      return offsetYNm <= 0
    case 'E':
      return offsetXNm >= 0
    case 'W':
      return offsetXNm <= 0
    case 'NE':
      return offsetXNm >= 0 && offsetYNm >= 0
    case 'NW':
      return offsetXNm <= 0 && offsetYNm >= 0
    case 'SE':
      return offsetXNm >= 0 && offsetYNm <= 0
    case 'SW':
      return offsetXNm <= 0 && offsetYNm <= 0
    default:
      return false
  }
}

function getLineSideMatch(routeLegs: FlightPlanInput['routeLegs'], rawText: string) {
  const side = extractLineSide(rawText)
  const linePoints = extractCoordinates(rawText)

  if (!side || linePoints.length < 2) {
    return null
  }

  let bestBoundaryDistanceNm = Number.POSITIVE_INFINITY
  let bestProgressNm = 0
  let routeProgressBeforeLegNm = 0

  for (const leg of routeLegs) {
    const legLengthNm = distanceNm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon)
    const samples = [
      { point: leg.from, progressNm: routeProgressBeforeLegNm },
      {
        point: { lat: (leg.from.lat + leg.to.lat) / 2, lon: (leg.from.lon + leg.to.lon) / 2 },
        progressNm: routeProgressBeforeLegNm + legLengthNm / 2,
      },
      { point: leg.to, progressNm: routeProgressBeforeLegNm + legLengthNm },
    ]

    for (const sample of samples) {
      for (let index = 0; index < linePoints.length - 1; index += 1) {
        const projection = pointToSegmentDistance(sample.point, linePoints[index], linePoints[index + 1])
        if (isPointOnRequestedSide(side, projection.signedOffsetXNm, projection.signedOffsetYNm)) {
          return {
            distanceNm: 0,
            progressNm: round(sample.progressNm),
            side,
          }
        }

        if (projection.lateralDistanceNm < bestBoundaryDistanceNm) {
          bestBoundaryDistanceNm = projection.lateralDistanceNm
          bestProgressNm = sample.progressNm
        }
      }
    }

    routeProgressBeforeLegNm += legLengthNm
  }

  return Number.isFinite(bestBoundaryDistanceNm)
    ? {
        distanceNm: round(bestBoundaryDistanceNm),
        progressNm: round(bestProgressNm),
        side,
      }
    : null
}

function getWideLineMatch(routeLegs: FlightPlanInput['routeLegs'], rawText: string) {
  const widthMatch = rawText.match(/\b(\d{2,3})(KM|NM)\s+WID\s+LINE\s+BTN\b/i)
  const linePoints = extractCoordinates(rawText)

  if (!widthMatch || linePoints.length < 2) {
    return null
  }

  const widthNm = widthMatch[2].toUpperCase() === 'KM'
    ? Number(widthMatch[1]) * 0.539957
    : Number(widthMatch[1])
  const boundary = routeDistanceToPolyline(routeLegs, linePoints)

  return {
    distanceNm: round(Math.max(0, boundary.distanceNm - widthNm / 2)),
    progressNm: boundary.progressNm,
    widthNm: round(widthNm),
  }
}

function getBestGeometryMatch(routeLegs: FlightPlanInput['routeLegs'], rawText: string) {
  const coordinates = extractCoordinates(rawText)
  const polygon = isClosedPolygon(coordinates, rawText) ? coordinates.slice(0, -1) : null
  const polygonIntersection = polygon && polygon.length >= 3 ? routeIntersectsPolygon(routeLegs, polygon) : null

  if (polygonIntersection) {
    return {
      coordinates,
      bestDistance: polygonIntersection,
      matchKinds: ['polygon'],
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
    matchKinds: coordinates.length > 0 ? ['coordinates'] : [],
  }
}

function getCircleCentreMatch(routeLegs: FlightPlanInput['routeLegs'], rawText: string) {
  const radiusMatch = rawText.match(/\bWI\s+(\d{2,3})(KM|NM)\s+OF\s+(?:TC\s+)?CENTR(?:E|ED ON)\b/i)
  const coordinates = extractCoordinates(rawText)
  const centre = coordinates[0]

  if (!radiusMatch || !centre) {
    return null
  }

  const radiusNm = radiusMatch[2].toUpperCase() === 'KM'
    ? Number(radiusMatch[1]) * 0.539957
    : Number(radiusMatch[1])
  const routeDistance = routeDistanceForPoint(routeLegs, centre)

  return {
    distanceNm: round(Math.max(0, routeDistance.distanceNm - radiusNm)),
    progressNm: routeDistance.progressNm,
    radiusNm: round(radiusNm),
  }
}

function getFirMatch(routeLegs: FlightPlanInput['routeLegs'], firCodes: string[]) {
  if (routeLegs.length === 0) {
    return null
  }

  if (firCodes.includes('ESAA')) {
    return {
      distanceNm: 0,
      progressNm: 0,
    }
  }

  return null
}

export function getRouteWeatherMatches(
  routeLegs: FlightPlanInput['routeLegs'],
  sectionText: string | null,
  maxDistanceNm = 50,
): RouteWeatherMatch[] {
  if (routeLegs.length === 0 || !sectionText) {
    return []
  }

  return splitSigmetEntries(sectionText)
    .map((entry, index) => {
      const firCodes = extractFirCodes(entry)
      const geometry = getBestGeometryMatch(routeLegs, entry)
      const circleMatch = getCircleCentreMatch(routeLegs, entry)
      const lineSideMatch = getLineSideMatch(routeLegs, entry)
      const wideLineMatch = getWideLineMatch(routeLegs, entry)
      const firMatch = getFirMatch(routeLegs, firCodes)
      const candidates = [
        geometry.bestDistance ? { ...geometry.bestDistance, kind: geometry.matchKinds[0] ?? 'coordinates' } : null,
        circleMatch ? { distanceNm: circleMatch.distanceNm, progressNm: circleMatch.progressNm, kind: 'radius-centre' } : null,
        lineSideMatch ? { distanceNm: lineSideMatch.distanceNm, progressNm: lineSideMatch.progressNm, kind: 'line-side' } : null,
        wideLineMatch ? { distanceNm: wideLineMatch.distanceNm, progressNm: wideLineMatch.progressNm, kind: 'wide-line' } : null,
        firMatch ? { ...firMatch, kind: 'fir' } : null,
      ].filter((value): value is { distanceNm: number; progressNm: number; kind: string } => Boolean(value))

      const best = candidates.reduce<typeof candidates[number] | null>(
        (closest, current) => (!closest || current.distanceNm < closest.distanceNm ? current : closest),
        null,
      )

      if (!best || best.distanceNm > maxDistanceNm) {
        return null
      }

      const summaries: string[] = []
      if (best.kind === 'fir' && firCodes.includes('ESAA')) {
        summaries.push('ESAA FIR')
      }
      if (best.kind === 'radius-centre' && circleMatch) {
        summaries.push(`Centrum/radie, närmast ${round(best.distanceNm)} NM`)
      }
      if (best.kind === 'line-side' && lineSideMatch) {
        summaries.push(`${lineSideMatch.side} of line`)
      }
      if (best.kind === 'wide-line' && wideLineMatch) {
        summaries.push(`Korridor ${wideLineMatch.widthNm} NM bred`)
      }
      if (best.kind !== 'fir' && geometry.coordinates.length > 0) {
        summaries.push(
          geometry.coordinates.length === 1
            ? `PSN ${round(best.distanceNm)} NM från rutten`
            : `${geometry.coordinates.length} koordinater/area, närmast ${round(best.distanceNm)} NM`,
        )
      }
      if (/\b(?:N|NE|E|SE|S|SW|W|NW)\s+OF\s+LINE\b/i.test(entry)) {
        summaries.push('Sidangivelse från linje förekommer')
      }

      return {
        id: `${index}-${firCodes[0] ?? 'sigmet'}`,
        title: deriveTitle(entry),
        rawText: entry,
        distanceNm: best.distanceNm,
        progressNm: best.progressNm,
        matchSummary: summaries.join(' · ') || `Närmast ${round(best.distanceNm)} NM från rutten`,
        firCodes,
        matchKinds: Array.from(new Set([
          ...geometry.matchKinds,
          ...(circleMatch ? ['radius-centre'] : []),
          ...(lineSideMatch ? ['line-side'] : []),
          ...(wideLineMatch ? ['wide-line'] : []),
          ...(firMatch ? ['fir'] : []),
        ])),
      }
    })
    .filter((value): value is RouteWeatherMatch => Boolean(value))
    .sort((left, right) => left.progressNm - right.progressNm || left.distanceNm - right.distanceNm)
}
