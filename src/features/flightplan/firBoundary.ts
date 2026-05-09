type RoutePoint = {
  lat: number
  lon: number
}

const earthRadiusNm = 3440.065

const SWEDEN_FIR_BOUNDARY: RoutePoint[] = [
  { lat: 69.06, lon: 20.54861 },
  { lat: 68.9807, lon: 20.91121 },
  { lat: 68.89461, lon: 20.90573 },
  { lat: 68.47701, lon: 22.07217 },
  { lat: 68.3949, lon: 22.80825 },
  { lat: 68.29025, lon: 23.06694 },
  { lat: 68.21744, lon: 23.15521 },
  { lat: 68.12204, lon: 23.16565 },
  { lat: 68.14561, lon: 23.30652 },
  { lat: 68.05125, lon: 23.383 },
  { lat: 67.95043, lon: 23.66215 },
  { lat: 67.86464, lon: 23.48128 },
  { lat: 67.58704, lon: 23.55353 },
  { lat: 67.48552, lon: 23.43126 },
  { lat: 67.42007, lon: 23.76519 },
  { lat: 67.33752, lon: 23.78566 },
  { lat: 67.26026, lon: 23.60272 },
  { lat: 67.15314, lon: 23.58133 },
  { lat: 66.8052, lon: 24.00404 },
  { lat: 66.75091, lon: 23.89242 },
  { lat: 66.56354, lon: 23.88188 },
  { lat: 66.45884, lon: 23.65244 },
  { lat: 66.31652, lon: 23.66277 },
  { lat: 66.20663, lon: 23.72416 },
  { lat: 66.16111, lon: 23.88932 },
  { lat: 66.04894, lon: 24.01965 },
  { lat: 65.84079, lon: 24.16341 },
  { lat: 65.76655, lon: 23.94386 },
  { lat: 65.53, lon: 24.14 },
  { lat: 63.61667, lon: 21.5 },
  { lat: 63.475, lon: 20.66667 },
  { lat: 63.16667, lon: 20.16667 },
  { lat: 61.66667, lon: 19.5 },
  { lat: 60.19167, lon: 19.08667 },
  { lat: 59.56278, lon: 19.98306 },
  { lat: 59, lon: 21 },
  { lat: 57, lon: 19.83333 },
  { lat: 55.85, lon: 17.55 },
  { lat: 54.91667, lon: 15.86667 },
  { lat: 54.91667, lon: 12.85 },
  { lat: 55.33667, lon: 12.64083 },
  { lat: 56.21472, lon: 12.36806 },
  { lat: 58.5, lon: 10.5 },
  { lat: 58.89222, lon: 10.63889 },
  { lat: 58.96882, lon: 11.11744 },
  { lat: 58.9914, lon: 11.18385 },
  { lat: 59.0082, lon: 11.115 },
  { lat: 59.08015, lon: 11.19361 },
  { lat: 59.09951, lon: 11.32097 },
  { lat: 58.99113, lon: 11.43814 },
  { lat: 58.89604, lon: 11.45199 },
  { lat: 58.92007, lon: 11.66438 },
  { lat: 59.24967, lon: 11.81166 },
  { lat: 59.60711, lon: 11.67492 },
  { lat: 59.71398, lon: 11.89724 },
  { lat: 59.87242, lon: 11.84959 },
  { lat: 59.89841, lon: 12.14373 },
  { lat: 60.08124, lon: 12.48325 },
  { lat: 60.1617, lon: 12.52469 },
  { lat: 60.31229, lon: 12.49172 },
  { lat: 60.41916, lon: 12.60531 },
  { lat: 60.51494, lon: 12.59435 },
  { lat: 60.7541, lon: 12.377 },
  { lat: 61.0017, lon: 12.25329 },
  { lat: 61.0462, lon: 12.7038 },
  { lat: 61.3615, lon: 12.88694 },
  { lat: 61.54704, lon: 12.61378 },
  { lat: 61.58229, lon: 12.41648 },
  { lat: 61.72484, lon: 12.16172 },
  { lat: 62.28612, lon: 12.31427 },
  { lat: 62.58631, lon: 12.09123 },
  { lat: 62.73369, lon: 12.15624 },
  { lat: 62.90743, lon: 12.0933 },
  { lat: 63.00148, lon: 12.22269 },
  { lat: 63.2889, lon: 11.99243 },
  { lat: 63.47427, lon: 12.2198 },
  { lat: 63.59813, lon: 12.17029 },
  { lat: 63.99139, lon: 12.75527 },
  { lat: 64.09087, lon: 13.23411 },
  { lat: 64.00953, lon: 13.96424 },
  { lat: 64.169, lon: 14.1478 },
  { lat: 64.46532, lon: 14.09695 },
  { lat: 64.58402, lon: 13.64276 },
  { lat: 65.08414, lon: 14.31068 },
  { lat: 65.24028, lon: 14.38024 },
  { lat: 65.31808, lon: 14.51429 },
  { lat: 65.70105, lon: 14.56069 },
  { lat: 65.80239, lon: 14.64885 },
  { lat: 66.12545, lon: 14.54054 },
  { lat: 66.15328, lon: 15.05338 },
  { lat: 66.27487, lon: 15.48188 },
  { lat: 66.49121, lon: 15.42627 },
  { lat: 66.59942, lon: 15.66946 },
  { lat: 66.88755, lon: 16.03884 },
  { lat: 67.03596, lon: 16.39965 },
  { lat: 67.20032, lon: 16.43789 },
  { lat: 67.42276, lon: 16.12711 },
  { lat: 67.4964, lon: 16.18075 },
  { lat: 67.55784, lon: 16.48295 },
  { lat: 67.89699, lon: 16.78288 },
  { lat: 68.1053, lon: 17.32145 },
  { lat: 67.97285, lon: 17.921 },
  { lat: 68.19873, lon: 18.18858 },
  { lat: 68.39572, lon: 18.13567 },
  { lat: 68.53592, lon: 18.17184 },
  { lat: 68.57385, lon: 18.43622 },
  { lat: 68.50125, lon: 18.64458 },
  { lat: 68.50564, lon: 19.03815 },
  { lat: 68.36389, lon: 20.01028 },
  { lat: 68.47737, lon: 20.24593 },
  { lat: 68.54119, lon: 19.96222 },
  { lat: 68.65907, lon: 20.23663 },
  { lat: 68.80459, lon: 20.35651 },
  { lat: 68.91006, lon: 20.34111 },
  { lat: 69.02214, lon: 20.10227 },
  { lat: 69.03636, lon: 20.62317 },
  { lat: 69.06, lon: 20.54861 },
]

function degToRad(value: number) {
  return (value * Math.PI) / 180
}

function distanceNm(from: RoutePoint, to: RoutePoint) {
  const lat1 = degToRad(from.lat)
  const lat2 = degToRad(to.lat)
  const dLat = degToRad(to.lat - from.lat)
  const dLon = degToRad(to.lon - from.lon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function coordinatesEqual(left: RoutePoint, right: RoutePoint, tolerance = 1e-7) {
  return Math.abs(left.lat - right.lat) < tolerance && Math.abs(left.lon - right.lon) < tolerance
}

function pushCoordinate(points: RoutePoint[], point: RoutePoint) {
  if (!points.some((candidate) => coordinatesEqual(candidate, point))) {
    points.push(point)
  }
}

function nearestBoundaryIndex(point: RoutePoint, boundary: RoutePoint[]) {
  let bestIndex = 0
  let bestDistanceNm = Number.POSITIVE_INFINITY

  boundary.forEach((candidate, index) => {
    const distance = distanceNm(point, candidate)
    if (distance < bestDistanceNm) {
      bestDistanceNm = distance
      bestIndex = index
    }
  })

  return { index: bestIndex, distanceNm: bestDistanceNm }
}

function boundaryPathLength(points: RoutePoint[]) {
  let lengthNm = 0

  for (let index = 1; index < points.length; index += 1) {
    lengthNm += distanceNm(points[index - 1], points[index])
  }

  return lengthNm
}

function boundarySlice(boundary: RoutePoint[], startIndex: number, endIndex: number, step: 1 | -1) {
  const points: RoutePoint[] = []
  let index = startIndex

  while (true) {
    points.push(boundary[index])
    if (index === endIndex) {
      break
    }

    index = (index + step + boundary.length) % boundary.length
  }

  return points
}

function getFirBoundaryPath(from: RoutePoint, to: RoutePoint) {
  const start = nearestBoundaryIndex(from, SWEDEN_FIR_BOUNDARY)
  const end = nearestBoundaryIndex(to, SWEDEN_FIR_BOUNDARY)

  if (start.distanceNm > 30 || end.distanceNm > 30 || start.index === end.index) {
    return []
  }

  const forward = boundarySlice(SWEDEN_FIR_BOUNDARY, start.index, end.index, 1)
  const backward = boundarySlice(SWEDEN_FIR_BOUNDARY, start.index, end.index, -1)
  const shortest = boundaryPathLength(forward) <= boundaryPathLength(backward) ? forward : backward

  return shortest.slice(1, -1)
}

function parseDmsCoordinateToken(value: string) {
  const match = value.match(/^(\d{6}(?:\.\d+)?[NS])\s*(\d{7}(?:\.\d+)?[EW])$/i)
  if (!match) {
    return null
  }

  const parseComponent = (component: string, degreeDigits: number) => {
    const hemisphere = component.slice(-1).toUpperCase()
    const numeric = component.slice(0, -1)
    const degrees = Number(numeric.slice(0, degreeDigits))
    const minutes = Number(numeric.slice(degreeDigits, degreeDigits + 2))
    const seconds = Number(numeric.slice(degreeDigits + 2))
    const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
    return sign * (degrees + minutes / 60 + seconds / 3600)
  }

  return {
    lat: parseComponent(match[1], 2),
    lon: parseComponent(match[2], 3),
  }
}

export function expandFirBoundaryDmsSegments(rawText: string, fallbackCoordinates: RoutePoint[]) {
  if (!/\balong\s+the\s+FIR\s+BDRY\b/i.test(rawText)) {
    return fallbackCoordinates
  }

  const tokenMatches = [...rawText.matchAll(/\d{6}(?:\.\d+)?[NS]\s*\d{7}(?:\.\d+)?[EW]|\balong\s+the\s+FIR\s+BDRY\s+to\b|\bto\s+point\s+of\s+origin\b/gi)]
  const coordinates: RoutePoint[] = []
  let previousCoordinate: RoutePoint | null = null
  let pendingFirBoundary = false

  for (const match of tokenMatches) {
    const token = match[0]
    const coordinate = parseDmsCoordinateToken(token)

    if (coordinate) {
      if (pendingFirBoundary && previousCoordinate) {
        getFirBoundaryPath(previousCoordinate, coordinate).forEach((point) => pushCoordinate(coordinates, point))
      }

      coordinates.push(coordinate)
      previousCoordinate = coordinate
      pendingFirBoundary = false
      continue
    }

    if (/^along\s+the\s+FIR\s+BDRY\s+to$/i.test(token)) {
      pendingFirBoundary = true
      continue
    }

    if (/^to\s+point\s+of\s+origin$/i.test(token) && pendingFirBoundary && previousCoordinate && coordinates[0]) {
      getFirBoundaryPath(previousCoordinate, coordinates[0]).forEach((point) => pushCoordinate(coordinates, point))
      pendingFirBoundary = false
    }
  }

  return coordinates.length > fallbackCoordinates.length ? coordinates : fallbackCoordinates
}
