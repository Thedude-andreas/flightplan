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

export async function fetchLfvWeatherBriefing() {
  const supabase = getSupabaseClient()

  if (!supabase) {
    throw new Error('Supabase är inte konfigurerat. LFV-väderbriefing kräver backend-stöd.')
  }

  const { data, error } = await supabase.functions.invoke('weather-briefing', {
    body: {},
  })

  if (error) {
    throw new Error(error.message)
  }

  return data as WeatherBriefingResponse
}
