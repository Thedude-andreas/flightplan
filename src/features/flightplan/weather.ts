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

export async function fetchWeatherForAirports(
  airports: NearbyAirport[],
  signal: AbortSignal,
): Promise<AirportWeather[]> {
  return Promise.all(
    airports.map(async (airport) => {
      const [metarResponse, tafResponse] = await Promise.all([
        fetchJson<MetarApiResponse>(`${METAR_TAF_API_BASE_URL}/metar?icao=${airport.icao}`, signal),
        fetchJson<TafApiResponse>(`${METAR_TAF_API_BASE_URL}/taf?icao=${airport.icao}`, signal).catch((error) => {
          if (error instanceof Error && error.message === 'HTTP 404') {
            return null
          }
          throw error
        }),
      ])

      return {
        airport,
        metarRawText: metarResponse.data?.[0]?.raw_text ?? null,
        metarObservedAt: metarResponse.data?.[0]?.obs_time ?? null,
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
