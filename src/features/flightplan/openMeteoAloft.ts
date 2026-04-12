import type { FlightPlanInput } from './types'
import { parseAltitudeFeet } from './weatherRoute'

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30] as const
const METERS_PER_FOOT = 0.3048
const ALOFT_CACHE_TTL_MS = 5 * 60 * 1000
const OPEN_METEO_MAX_CONCURRENT_REQUESTS = 2
const OPEN_METEO_MAX_RETRIES = 3
const OPEN_METEO_RETRY_DELAY_MS = 1200

export type AloftWind = {
  direction: number
  speedKt: number
}

export type RouteLegAloftWind = AloftWind & {
  midpoint: { lat: number; lon: number }
  altitudeMetersMsl: number
  requestedTime: string
}

type HourlyResponse = {
  time?: string[]
  [key: string]: Array<number | null> | string[] | undefined
}

type OpenMeteoForecastResponse = {
  hourly?: HourlyResponse
}

type CachedAloftWind = {
  value: RouteLegAloftWind
  cachedAtMs: number
}

const aloftWindCache = new Map<string, CachedAloftWind>()

function round(value: number) {
  return Math.round(value)
}

function normalizeDegrees(value: number) {
  const result = value % 360
  return result < 0 ? result + 360 : result
}

function toWindVector(speedKt: number, directionFromDeg: number) {
  const directionRad = (directionFromDeg * Math.PI) / 180
  return {
    u: -speedKt * Math.sin(directionRad),
    v: -speedKt * Math.cos(directionRad),
  }
}

function fromWindVector(u: number, v: number): AloftWind {
  const speedKt = Math.hypot(u, v)
  const direction = normalizeDegrees((Math.atan2(-u, -v) * 180) / Math.PI)
  return {
    direction: round(direction),
    speedKt: round(speedKt),
  }
}

function interpolateWind(
  lowerHeightMeters: number,
  upperHeightMeters: number,
  targetHeightMeters: number,
  lowerWind: AloftWind,
  upperWind: AloftWind,
) {
  const heightSpan = upperHeightMeters - lowerHeightMeters
  if (heightSpan <= 1e-6) {
    return lowerWind
  }

  const factor = Math.max(0, Math.min(1, (targetHeightMeters - lowerHeightMeters) / heightSpan))
  const lowerVector = toWindVector(lowerWind.speedKt, lowerWind.direction)
  const upperVector = toWindVector(upperWind.speedKt, upperWind.direction)
  return fromWindVector(
    lowerVector.u + (upperVector.u - lowerVector.u) * factor,
    lowerVector.v + (upperVector.v - lowerVector.v) * factor,
  )
}

function getRequestedDateTime(date: string, time: string) {
  const normalizedDate = date.trim()
  const normalizedTime = time.trim() || '12:00'
  return normalizedDate ? `${normalizedDate}T${normalizedTime}` : ''
}

function getAltitudeMetersMsl(altitudeLabel: string) {
  const altitudeFeet = parseAltitudeFeet(altitudeLabel.trim()) ?? 3000
  return altitudeFeet * METERS_PER_FOOT
}

function getMidpoint(leg: FlightPlanInput['routeLegs'][number]) {
  return {
    lat: (leg.from.lat + leg.to.lat) / 2,
    lon: (leg.from.lon + leg.to.lon) / 2,
  }
}

function getHourlyNumberArray(hourly: HourlyResponse, key: string) {
  const value = hourly[key]
  return Array.isArray(value) ? value : null
}

function getLegRequestCacheKey(
  leg: FlightPlanInput['routeLegs'][number],
  requestedTime: string,
  timezone: string,
) {
  const midpoint = getMidpoint(leg)
  const altitudeMetersMsl = round(getAltitudeMetersMsl(leg.altitude))
  return [
    midpoint.lat.toFixed(4),
    midpoint.lon.toFixed(4),
    altitudeMetersMsl,
    requestedTime,
    timezone,
  ].join('|')
}

function readCachedLegAloftWind(cacheKey: string) {
  const cached = aloftWindCache.get(cacheKey)
  if (!cached) {
    return null
  }

  if (Date.now() - cached.cachedAtMs > ALOFT_CACHE_TTL_MS) {
    aloftWindCache.delete(cacheKey)
    return null
  }

  return cached.value
}

function storeCachedLegAloftWind(cacheKey: string, value: RouteLegAloftWind) {
  aloftWindCache.set(cacheKey, {
    value,
    cachedAtMs: Date.now(),
  })
}

function parseRetryAfterMilliseconds(response: Response) {
  const retryAfter = response.headers.get('retry-after')
  if (!retryAfter) {
    return null
  }

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  const timestampMs = Date.parse(retryAfter)
  if (Number.isFinite(timestampMs)) {
    return Math.max(0, timestampMs - Date.now())
  }

  return null
}

function waitForDelay(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)

    const onAbort = () => {
      window.clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)
  })
}

async function fetchLegAloftWind(
  leg: FlightPlanInput['routeLegs'][number],
  requestedTime: string,
  timezone: string,
  signal: AbortSignal,
): Promise<RouteLegAloftWind> {
  const midpoint = getMidpoint(leg)
  const altitudeMetersMsl = getAltitudeMetersMsl(leg.altitude)
  const cacheKey = getLegRequestCacheKey(leg, requestedTime, timezone)
  const cached = readCachedLegAloftWind(cacheKey)
  if (cached) {
    return cached
  }
  const hourlyVariables = PRESSURE_LEVELS.flatMap((level) => [
    `wind_speed_${level}hPa`,
    `wind_direction_${level}hPa`,
    `geopotential_height_${level}hPa`,
  ])

  const url = new URL(OPEN_METEO_FORECAST_URL)
  url.searchParams.set('latitude', String(midpoint.lat))
  url.searchParams.set('longitude', String(midpoint.lon))
  url.searchParams.set('hourly', hourlyVariables.join(','))
  url.searchParams.set('wind_speed_unit', 'kn')
  url.searchParams.set('timezone', timezone)
  url.searchParams.set('start_hour', requestedTime)
  url.searchParams.set('end_hour', requestedTime)

  let response: Response | null = null
  for (let attempt = 0; attempt <= OPEN_METEO_MAX_RETRIES; attempt += 1) {
    response = await fetch(url, { signal })
    if (response.ok) {
      break
    }

    if (response.status !== 429 || attempt === OPEN_METEO_MAX_RETRIES) {
      throw new Error(`Open-Meteo svarade med HTTP ${response.status}`)
    }

    const retryDelayMs =
      parseRetryAfterMilliseconds(response)
      ?? OPEN_METEO_RETRY_DELAY_MS * (attempt + 1)

    await waitForDelay(retryDelayMs, signal)
  }

  if (!response?.ok) {
    throw new Error('Open-Meteo svarade inte med giltig höjdvind.')
  }

  const payload = (await response.json()) as OpenMeteoForecastResponse
  const hourly = payload.hourly
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    throw new Error('Open-Meteo returnerade ingen timdata för vald tid.')
  }

  const samples = PRESSURE_LEVELS.map((level) => {
    const speedValues = getHourlyNumberArray(hourly, `wind_speed_${level}hPa`)
    const directionValues = getHourlyNumberArray(hourly, `wind_direction_${level}hPa`)
    const heightValues = getHourlyNumberArray(hourly, `geopotential_height_${level}hPa`)
    const speedKt = speedValues?.[0]
    const direction = directionValues?.[0]
    const heightMeters = heightValues?.[0]

    if (typeof speedKt !== 'number' || typeof direction !== 'number' || typeof heightMeters !== 'number') {
      return null
    }

    return {
      heightMeters,
      wind: {
        direction,
        speedKt,
      },
    }
  }).filter((value): value is { heightMeters: number; wind: AloftWind } => Boolean(value))

  if (samples.length === 0) {
    throw new Error('Open-Meteo saknade höjdvind för vald punkt.')
  }

  const lowerSample = [...samples].reverse().find((sample) => sample.heightMeters <= altitudeMetersMsl) ?? samples[0]
  const upperSample = samples.find((sample) => sample.heightMeters >= altitudeMetersMsl) ?? samples.at(-1) ?? samples[0]
  const wind =
    lowerSample === upperSample
      ? lowerSample.wind
      : interpolateWind(
          lowerSample.heightMeters,
          upperSample.heightMeters,
          altitudeMetersMsl,
          lowerSample.wind,
          upperSample.wind,
        )

  const result = {
    ...wind,
    midpoint,
    altitudeMetersMsl: round(altitudeMetersMsl),
    requestedTime,
  }

  storeCachedLegAloftWind(cacheKey, result)
  return result
}

export async function fetchRouteLegAloftWinds(
  routeLegs: FlightPlanInput['routeLegs'],
  date: string,
  time: string,
  signal: AbortSignal,
) {
  const requestedTime = getRequestedDateTime(date, time)
  if (!requestedTime || routeLegs.length === 0) {
    return []
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const results = new Array<RouteLegAloftWind>(routeLegs.length)
  let nextIndex = 0

  async function runWorker() {
    while (nextIndex < routeLegs.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await fetchLegAloftWind(routeLegs[currentIndex], requestedTime, timezone, signal)
    }
  }

  const workerCount = Math.min(OPEN_METEO_MAX_CONCURRENT_REQUESTS, routeLegs.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}
