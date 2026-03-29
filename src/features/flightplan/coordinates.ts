import type { RoutePointInput } from './types'

const ARCSECONDS_PER_DEGREE = 3600

export function snapCoordinate(value: number) {
  return Math.round(value * ARCSECONDS_PER_DEGREE) / ARCSECONDS_PER_DEGREE
}

export function snapPoint(point: RoutePointInput): RoutePointInput {
  return {
    ...point,
    lat: snapCoordinate(point.lat),
    lon: snapCoordinate(point.lon),
  }
}

export function formatCoordinateDms(value: number, axis: 'lat' | 'lon') {
  const hemisphere = axis === 'lat'
    ? value >= 0 ? 'N' : 'S'
    : value >= 0 ? 'E' : 'W'

  const absolute = Math.abs(value)
  const totalSeconds = Math.round(absolute * ARCSECONDS_PER_DEGREE)
  const degrees = Math.floor(totalSeconds / ARCSECONDS_PER_DEGREE)
  const minutes = Math.floor((totalSeconds % ARCSECONDS_PER_DEGREE) / 60)
  const seconds = totalSeconds % 60

  return `${degrees}°${String(minutes).padStart(2, '0')}'${String(seconds).padStart(2, '0')}"${hemisphere}`
}

export function parseCoordinateDms(input: string, axis: 'lat' | 'lon') {
  const normalized = input.trim().toUpperCase().replaceAll(',', '.')
  if (!normalized) {
    return null
  }

  const hemisphereMatch = normalized.match(/[NSEW]/)
  const hemisphere = hemisphereMatch?.[0]
  const sign = hemisphere === 'S' || hemisphere === 'W' || normalized.startsWith('-') ? -1 : 1
  const numbers = normalized.match(/\d+(?:\.\d+)?/g)

  if (!numbers || numbers.length === 0) {
    return null
  }

  let decimal = 0

  if (numbers.length === 1) {
    decimal = Number(numbers[0])
  } else {
    const degrees = Number(numbers[0])
    const minutes = Number(numbers[1] ?? 0)
    const seconds = Number(numbers[2] ?? 0)
    decimal = degrees + minutes / 60 + seconds / ARCSECONDS_PER_DEGREE
  }

  if (!Number.isFinite(decimal)) {
    return null
  }

  const signed = Math.abs(decimal) * sign
  const limit = axis === 'lat' ? 90 : 180

  if (Math.abs(signed) > limit) {
    return null
  }

  return snapCoordinate(signed)
}
