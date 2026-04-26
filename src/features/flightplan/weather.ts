import { getSupabaseClient } from '../../lib/supabase/client'
import { getSwedishAirports, type SwedishAirport } from './aviationData'
import type { FlightPlanInput } from './types'

const METAR_TAF_API_BASE_URL = 'https://skyvok.com/api'

export type NearbyAirport = SwedishAirport & {
  icao: string
  name: string
  distanceNm: number
}

export type AirportWeather = {
  airport: NearbyAirport
  metarRawText: string | null
  metarObservedAt: string | null
  tafRawText: string | null
  tafIssuedAt: string | null
}

export type AirportMetar = {
  airport: NearbyAirport
  metarRawText: string | null
  metarObservedAt: string | null
  /** Sätts i klientcache när observationstid saknas (t.ex. 404); används för TTL. */
  cachedAtMs?: number
}

export type AirportMapWeather = {
  airport: NearbyAirport
  metarRawText: string | null
  metarObservedAt: string | null
  tafRawText: string | null
  tafIssuedAt: string | null
  /** Sätts i klientcache för negativa svar utan rapporttid, t.ex. saknad METAR/TAF. */
  cachedAtMs?: number
}

/** Maximal ålder innan kartväder hämtas om. Rapporter med tid mäts från publicerings-/observationstid. */
export const WEATHER_MAP_CACHE_MAX_AGE_MS = 20 * 60 * 1000

function parseReportTimestampToMs(timestamp: string | null): number | null {
  if (!timestamp) {
    return null
  }

  const trimmed = timestamp.trim()
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    if (n >= 1e12) {
      return n
    }

    if (n >= 1e9) {
      return n * 1000
    }
  }

  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

function isReportStale(publishedAt: string | null, hasRawReport: boolean): boolean {
  const publishedMs = parseReportTimestampToMs(publishedAt)
  if (publishedMs != null) {
    return Date.now() - publishedMs > WEATHER_MAP_CACHE_MAX_AGE_MS
  }

  return hasRawReport
}

/** Sant om kartväder saknas eller någon befintlig rapport är för gammal. */
export function needsAirportWeatherRefetchForMap(cached: AirportMapWeather | undefined): boolean {
  if (!cached) {
    return true
  }

  if (isReportStale(cached.metarObservedAt, Boolean(cached.metarRawText))) {
    return true
  }

  if (isReportStale(cached.tafIssuedAt, Boolean(cached.tafRawText))) {
    return true
  }

  if (cached.cachedAtMs != null) {
    return Date.now() - cached.cachedAtMs > WEATHER_MAP_CACHE_MAX_AGE_MS
  }

  return true
}

export type MetarFlightCategory = 'VMC' | 'MVMC' | 'IMC' | 'UNKNOWN'

export type MetarFlightRules = {
  category: MetarFlightCategory
  visibilityMeters: number | null
  ceilingFeet: number | null
}

export type LfvWindLevel = {
  label: string
  altitudeFt: number
  rawText: string
}

export type LfvLhpArea = {
  id: 'se1' | 'se2' | 'se3' | 'se4'
  title: string
  sourceUrl: string
  overviewText: string | null
  areaText: string | null
  issuedAt: string | null
  validFrom: string | null
  validTo: string | null
  windLevels: LfvWindLevel[]
}

export type LfvWeatherBriefing = {
  fetchedAt: string | null
  sigmetSourceUrl: string | null
  sigmetPublishedAt: string | null
  sigmetText: string | null
  lhpAreas: LfvLhpArea[]
}

type WeatherBriefingResponse = {
  fetchedAt: string | null
  sigmetSourceUrl: string | null
  sigmetPublishedAt: string | null
  sigmetText: string | null
  lhpAreas: LfvLhpArea[]
}

function degToRad(value: number) {
  return (value * Math.PI) / 180
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function distanceNm(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const earthRadiusNm = 3440.065
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

function pointToSegmentDistanceNm(
  point: { lat: number; lon: number },
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
) {
  const referenceLat = (point.lat + start.lat + end.lat) / 3
  const pointNm = toLocalNm(point.lat, point.lon, referenceLat)
  const startNm = toLocalNm(start.lat, start.lon, referenceLat)
  const endNm = toLocalNm(end.lat, end.lon, referenceLat)
  const segmentX = endNm.x - startNm.x
  const segmentY = endNm.y - startNm.y
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2

  if (segmentLengthSquared < 1e-9) {
    return distanceNm(point.lat, point.lon, start.lat, start.lon)
  }

  const projection =
    ((pointNm.x - startNm.x) * segmentX + (pointNm.y - startNm.y) * segmentY) /
    segmentLengthSquared
  const clampedProjection = Math.max(0, Math.min(1, projection))
  const closestX = startNm.x + segmentX * clampedProjection
  const closestY = startNm.y + segmentY * clampedProjection

  return Math.hypot(pointNm.x - closestX, pointNm.y - closestY)
}

export function getAirportsNearRoute(
  routeLegs: FlightPlanInput['routeLegs'],
  maxDistanceNm = 50,
): NearbyAirport[] {
  if (routeLegs.length === 0) {
    return []
  }

  return getSwedishAirports()
    .filter((airport): airport is SwedishAirport & { icao: string; name: string } => Boolean(airport.icao && airport.name))
    .map((airport) => {
      const nearestDistanceNm = routeLegs.reduce((closestDistance, leg) => {
        const nextDistance = pointToSegmentDistanceNm(
          { lat: airport.lat, lon: airport.lon },
          leg.from,
          leg.to,
        )
        return Math.min(closestDistance, nextDistance)
      }, Number.POSITIVE_INFINITY)

      return {
        ...airport,
        distanceNm: round(nearestDistanceNm),
      }
    })
    .filter((airport) => airport.distanceNm <= maxDistanceNm)
    .sort((left, right) => left.distanceNm - right.distanceNm || left.icao.localeCompare(right.icao, 'sv'))
}

type MetarApiResponse = {
  data?: Array<{
    raw_text?: string | null
    obs_time?: string | null
  }>
}

type TafApiResponse = {
  data?: {
    raw_text?: string | null
    issue_time?: string | null
  } | null
}

async function fetchJson<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function parseStatuteMilesToMeters(rawValue: string) {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  let miles = 0
  for (const part of trimmed.split(/\s+/)) {
    if (/^\d+$/.test(part)) {
      miles += Number(part)
      continue
    }

    const fractionMatch = part.match(/^(\d+)\/(\d+)$/)
    if (fractionMatch) {
      miles += Number(fractionMatch[1]) / Number(fractionMatch[2])
      continue
    }

    return null
  }

  return Math.round(miles * 1609.344)
}

function parseMetarVisibilityMeters(rawText: string) {
  if (/\bCAVOK\b/.test(rawText)) {
    return 10000
  }

  const visibilityMatch = rawText.match(/(?:^|\s)(\d{4})(?=\s)/)
  if (visibilityMatch) {
    return visibilityMatch[1] === '9999' ? 10000 : Number(visibilityMatch[1])
  }

  const statuteMilesMatch = rawText.match(/(?:^|\s)(M?\d+(?: \d+\/\d+)?|\d+\/\d+)?SM(?=\s|$)/)
  if (!statuteMilesMatch) {
    return null
  }

  const normalized = (statuteMilesMatch[1] ?? '').replace(/^M/, '')
  return parseStatuteMilesToMeters(normalized)
}

function parseMetarCeilingFeet(rawText: string) {
  if (/\b(CAVOK|NSC|NCD|SKC|CLR)\b/.test(rawText)) {
    return null
  }

  const layers = Array.from(rawText.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g))
  if (layers.length === 0) {
    return null
  }

  return layers.reduce<number>((lowest, match) => {
    const nextLayerFeet = Number(match[2]) * 100
    return Math.min(lowest, nextLayerFeet)
  }, Number.POSITIVE_INFINITY)
}

function worseFlightCategory(left: MetarFlightCategory, right: MetarFlightCategory): MetarFlightCategory {
  const rank = {
    UNKNOWN: 0,
    VMC: 1,
    MVMC: 2,
    IMC: 3,
  } as const

  return rank[left] >= rank[right] ? left : right
}

export function classifyMetarFlightRules(rawText: string | null): MetarFlightRules {
  if (!rawText) {
    return {
      category: 'UNKNOWN',
      visibilityMeters: null,
      ceilingFeet: null,
    }
  }

  const visibilityMeters = parseMetarVisibilityMeters(rawText)
  const ceilingFeet = parseMetarCeilingFeet(rawText)

  if (visibilityMeters == null && ceilingFeet == null) {
    return {
      category: 'UNKNOWN',
      visibilityMeters: null,
      ceilingFeet: null,
    }
  }

  const effectiveVisibility = visibilityMeters ?? Number.POSITIVE_INFINITY
  const effectiveCeiling = ceilingFeet ?? Number.POSITIVE_INFINITY

  if (effectiveVisibility < 5000 || effectiveCeiling < 1500) {
    return { category: 'IMC', visibilityMeters, ceilingFeet }
  }

  if (effectiveVisibility < 8000 || effectiveCeiling < 3000) {
    return { category: 'MVMC', visibilityMeters, ceilingFeet }
  }

  return { category: 'VMC', visibilityMeters, ceilingFeet }
}

function splitTafIntoForecastSegments(rawText: string) {
  const cleaned = rawText
    .replace(/\s+/g, ' ')
    .replace(/^TAF(?:\s+(?:AMD|COR))?\s+[A-Z]{4}\s+\d{4}\/\d{4}\s*/i, '')
    .trim()

  if (!cleaned) {
    return []
  }

  const changeMarker = /\b(BECMG|TEMPO|INTER|PROB\d{2}(?:\s+TEMPO)?|FM\d{6})\b/gi
  const markers = [...cleaned.matchAll(changeMarker)]
  if (markers.length === 0) {
    return [cleaned]
  }

  const segments: string[] = []
  let start = 0
  for (const marker of markers) {
    const index = marker.index ?? 0
    const before = cleaned.slice(start, index).trim()
    if (before) {
      segments.push(before)
    }
    start = index
  }

  const tail = cleaned.slice(start).trim()
  if (tail) {
    segments.push(tail)
  }

  return segments
}

export function classifyTafFlightRules(rawText: string | null): MetarFlightRules {
  if (!rawText) {
    return {
      category: 'UNKNOWN',
      visibilityMeters: null,
      ceilingFeet: null,
    }
  }

  const segments = splitTafIntoForecastSegments(rawText)
  const classified = segments.map((segment) => classifyMetarFlightRules(segment))
  const known = classified.filter((entry) => entry.category !== 'UNKNOWN')

  if (known.length === 0) {
    return {
      category: 'UNKNOWN',
      visibilityMeters: null,
      ceilingFeet: null,
    }
  }

  const distinctCategories = new Set(known.map((entry) => entry.category))
  if (distinctCategories.size > 1) {
    return {
      category: 'MVMC',
      visibilityMeters: null,
      ceilingFeet: null,
    }
  }

  return known.reduce(
    (worst, entry) => ({
      category: worseFlightCategory(worst.category, entry.category),
      visibilityMeters:
        worst.visibilityMeters == null
          ? entry.visibilityMeters
          : entry.visibilityMeters == null
            ? worst.visibilityMeters
            : Math.min(worst.visibilityMeters, entry.visibilityMeters),
      ceilingFeet:
        worst.ceilingFeet == null
          ? entry.ceilingFeet
          : entry.ceilingFeet == null
            ? worst.ceilingFeet
            : Math.min(worst.ceilingFeet, entry.ceilingFeet),
    }),
    {
      category: 'UNKNOWN' as MetarFlightCategory,
      visibilityMeters: null,
      ceilingFeet: null,
    },
  )
}

export function mergeFlightRules(...entries: Array<MetarFlightRules | null | undefined>): MetarFlightRules {
  const known = entries.filter((entry): entry is MetarFlightRules => Boolean(entry))
  return known.reduce(
    (merged, entry) => ({
      category: worseFlightCategory(merged.category, entry.category),
      visibilityMeters:
        merged.visibilityMeters == null
          ? entry.visibilityMeters
          : entry.visibilityMeters == null
            ? merged.visibilityMeters
            : Math.min(merged.visibilityMeters, entry.visibilityMeters),
      ceilingFeet:
        merged.ceilingFeet == null
          ? entry.ceilingFeet
          : entry.ceilingFeet == null
            ? merged.ceilingFeet
            : Math.min(merged.ceilingFeet, entry.ceilingFeet),
    }),
    {
      category: 'UNKNOWN' as MetarFlightCategory,
      visibilityMeters: null,
      ceilingFeet: null,
    },
  )
}

async function fetchMetarForAirport(airport: NearbyAirport, signal: AbortSignal): Promise<AirportMetar> {
  try {
    const metarResponse = await fetchJson<MetarApiResponse>(`${METAR_TAF_API_BASE_URL}/metar?icao=${airport.icao}`, signal)
    return {
      airport,
      metarRawText: metarResponse.data?.[0]?.raw_text ?? null,
      metarObservedAt: metarResponse.data?.[0]?.obs_time ?? null,
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'HTTP 404') {
      return {
        airport,
        metarRawText: null,
        metarObservedAt: null,
      }
    }

    throw error
  }
}

export async function fetchMetarsForAirports(
  airports: NearbyAirport[],
  signal: AbortSignal,
): Promise<AirportMetar[]> {
  const settled = await Promise.allSettled(
    airports.map((airport) => fetchMetarForAirport(airport, signal)),
  )

  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

export async function fetchMapWeatherForAirports(
  airports: NearbyAirport[],
  signal: AbortSignal,
): Promise<AirportMapWeather[]> {
  const settled = await Promise.allSettled(
    airports.map(async (airport) => {
      const [metarResponse, tafResponse] = await Promise.all([
        fetchMetarForAirport(airport, signal),
        fetchJson<TafApiResponse>(`${METAR_TAF_API_BASE_URL}/taf?icao=${airport.icao}`, signal).catch((error) => {
          if (error instanceof Error && error.message === 'HTTP 404') {
            return null
          }
          throw error
        }),
      ])

      return {
        airport,
        metarRawText: metarResponse.metarRawText,
        metarObservedAt: metarResponse.metarObservedAt,
        tafRawText: tafResponse?.data?.raw_text ?? null,
        tafIssuedAt: tafResponse?.data?.issue_time ?? null,
      } satisfies AirportMapWeather
    }),
  )

  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

export async function fetchWeatherForAirports(
  airports: NearbyAirport[],
  signal: AbortSignal,
): Promise<AirportWeather[]> {
  return Promise.all(
    airports.map(async (airport) => {
      const [metarResponse, tafResponse] = await Promise.all([
        fetchMetarForAirport(airport, signal),
        fetchJson<TafApiResponse>(`${METAR_TAF_API_BASE_URL}/taf?icao=${airport.icao}`, signal).catch((error) => {
          if (error instanceof Error && error.message === 'HTTP 404') {
            return null
          }
          throw error
        }),
      ])

      return {
        airport,
        metarRawText: metarResponse.metarRawText,
        metarObservedAt: metarResponse.metarObservedAt,
        tafRawText: tafResponse?.data?.raw_text ?? null,
        tafIssuedAt: tafResponse?.data?.issue_time ?? null,
      }
    }),
  )
}

export async function fetchLfvWeatherBriefing(forceRefresh = false) {
  const supabase = getSupabaseClient()

  if (!supabase) {
    throw new Error('Supabase är inte konfigurerat. LFV-väderbriefing kräver backend-stöd.')
  }

  const { data, error } = await supabase.functions.invoke('weather-briefing', {
    body: { forceRefresh },
  })

  if (error) {
    throw new Error(error.message)
  }

  return data as WeatherBriefingResponse
}
