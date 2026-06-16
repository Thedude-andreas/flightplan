const ARCSECONDS_PER_DEGREE = 3600

export function snapCoordinate(value: number) {
  return Math.round(value * ARCSECONDS_PER_DEGREE) / ARCSECONDS_PER_DEGREE
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
