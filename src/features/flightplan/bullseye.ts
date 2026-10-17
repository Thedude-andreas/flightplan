import proj4 from 'proj4'
import * as mgrs from 'mgrs'
import GeographicLib from 'geographiclib-geodesic'

export type BullseyePoint = { lat: number; lon: number }
export type CoordinateSystem = 'dd' | 'ddm' | 'dms' | 'sweref' | 'rt90' | 'utm' | 'mgrs' | 'custom'
export const normalizeBearing = (value: number) => ((value % 360) + 360) % 360
export function validatePoint(point: BullseyePoint): BullseyePoint {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) >= 90 || Math.abs(point.lon) > 180) {
    throw new Error('Ange en giltig position mellan polerna, med longitud −180 till 180°. Polerna saknar entydig nordreferens.')
  }
  return point
}
export function parseAngle(text: string, axis: 'lat' | 'lon', format: 'dd' | 'ddm' | 'dms') {
  const value = text.trim().toUpperCase().replace(',', '.')
  const hemispheres = value.match(/[NSEW]/g) ?? []
  if (hemispheres.length > 1 || (hemispheres[0] && !(axis === 'lat' ? 'NS' : 'EW').includes(hemispheres[0] ?? ''))) throw new Error('Fel väderstreck för koordinaten.')
  const body = value.replace(/[NSEW]/g, '').replace(/[°º′'″" :]/g, ' ').trim()
  if (!/^[+-]?\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)*$/.test(body)) throw new Error('Kontrollera koordinatformatet.')
  const parts = body.split(/\s+/).map(Number)
  const count = format === 'dd' ? 1 : format === 'ddm' ? 2 : 3
  if (parts.length !== count || parts.slice(1).some(n => n < 0 || n >= 60) || (count > 1 && !Number.isInteger(parts[0])) || (count === 3 && !Number.isInteger(parts[1]))) throw new Error('Kontrollera grader, minuter och sekunder (minuter/sekunder < 60).')
  if (hemispheres.length && /^[+-]/.test(body)) throw new Error('Använd antingen tecken eller väderstreck, inte båda.')
  const negative = /^[−-]/.test(body) || ['S', 'W'].includes(hemispheres[0] ?? '')
  return (negative ? -1 : 1) * (Math.abs(parts[0]) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600)
}
export function parseBullseyeCoordinates(system: CoordinateSystem, first: string, second: string, zone = '34', south = false, definition = ''): BullseyePoint {
  if (system === 'dd' || system === 'ddm' || system === 'dms') return validatePoint({ lat: parseAngle(first, 'lat', system), lon: parseAngle(second, 'lon', system) })
  if (system === 'mgrs') {
    const input = first.replace(/\s/g, '').toUpperCase()
    if (!/^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(?:\d{2}){0,5}$/.test(input)) throw new Error('Ange en giltig MGRS-ruta med lika många siffror för öst och nord.')
    const [lon, lat] = mgrs.toPoint(input)
    return validatePoint({ lat, lon })
  }
  const parseNumber = (text: string) => {
    if (!text.trim()) throw new Error('Fyll i båda koordinaterna.')
    const number = Number(text.trim().replace(',', '.'))
    if (!Number.isFinite(number)) throw new Error('Koordinaterna måste vara tal.')
    return number
  }
  const north = parseNumber(first), east = parseNumber(second)
  let source: string
  if (system === 'sweref') source = '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs'
  else if (system === 'rt90') source = '+proj=tmerc +lat_0=0 +lon_0=15.8062845294444 +k=1.00000561024 +x_0=1500064.274 +y_0=-667.711 +ellps=GRS80 +units=m +no_defs'
  else if (system === 'utm') {
    if (!/^\d{1,2}$/.test(zone) || Number(zone) < 1 || Number(zone) > 60) throw new Error('UTM-zon måste vara 1–60.')
    if (east < 100000 || east >= 1000000 || north < 0 || north > 10000000) throw new Error('Kontrollera UTM nord/öst.')
    source = `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`
  } else {
    if (!definition.trim().startsWith('+proj=')) throw new Error('Ange en PROJ-definition som börjar med +proj=.')
    source = definition
  }
  try {
    const [lon, lat] = proj4(source, 'EPSG:4326', [east, north])
    return validatePoint({ lat, lon })
  } catch { throw new Error('Koordinaterna kunde inte omvandlas. Kontrollera system, värden och eventuell PROJ-definition.') }
}
export function bullseyeRelative(origin: BullseyePoint, target: BullseyePoint, declination = 0) {
  validatePoint(origin); validatePoint(target)
  const result = GeographicLib.Geodesic.WGS84.Inverse(origin.lat, origin.lon, target.lat, target.lon)
  const distanceNm = result.s12! / 1852
  return { distanceNm, bearing: distanceNm < 1e-8 ? null : normalizeBearing(result.azi1! - declination) }
}
export function bullseyeDestination(origin: BullseyePoint, bearing: number, distanceNm: number, declination = 0): BullseyePoint {
  validatePoint(origin)
  if (!Number.isFinite(bearing) || bearing < 0 || bearing > 360 || !Number.isFinite(distanceNm) || distanceNm < 0 || distanceNm > 10000 || !Number.isFinite(declination)) throw new Error('Ange bäring 0–360° och avstånd 0–10 000 NM.')
  const result = GeographicLib.Geodesic.WGS84.Direct(origin.lat, origin.lon, bearing + declination, distanceNm * 1852)
  return validatePoint({ lat: result.lat2!, lon: result.lon2! })
}
