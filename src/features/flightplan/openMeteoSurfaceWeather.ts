const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

type OpenMeteoSurfaceResponse = {
  hourly?: {
    time?: string[]
    temperature_2m?: Array<number | null>
    pressure_msl?: Array<number | null>
  }
  error?: boolean
  reason?: string
}

export type OpenMeteoSurfacePerformanceWeather = {
  temperatureC: number
  qnhHpa: number
  requestedTime: string
}

function getRequestedHour(date: string, time: string) {
  const normalizedDate = date.trim()
  if (!normalizedDate) {
    return ''
  }

  const hour = (time.trim() || '12:00').slice(0, 2).padStart(2, '0')
  return `${normalizedDate}T${hour}:00`
}

export async function fetchOpenMeteoSurfacePerformanceWeather(
  point: { lat: number; lon: number },
  date: string,
  time: string,
  signal: AbortSignal,
): Promise<OpenMeteoSurfacePerformanceWeather | null> {
  const requestedTime = getRequestedHour(date, time)
  if (!requestedTime) {
    return null
  }

  const url = new URL(OPEN_METEO_FORECAST_URL)
  url.searchParams.set('latitude', String(point.lat))
  url.searchParams.set('longitude', String(point.lon))
  url.searchParams.set('hourly', 'temperature_2m,pressure_msl')
  url.searchParams.set('timezone', 'UTC')
  url.searchParams.set('start_hour', requestedTime)
  url.searchParams.set('end_hour', requestedTime)

  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Open-Meteo väder svarade ${response.status}.`)
  }

  const data = (await response.json()) as OpenMeteoSurfaceResponse
  if (data.error) {
    throw new Error(data.reason ?? 'Open-Meteo väder kunde inte hämta startväder.')
  }

  const temperatureC = data.hourly?.temperature_2m?.[0]
  const pressureMslHpa = data.hourly?.pressure_msl?.[0]
  if (
    typeof temperatureC !== 'number' ||
    !Number.isFinite(temperatureC) ||
    typeof pressureMslHpa !== 'number' ||
    !Number.isFinite(pressureMslHpa)
  ) {
    throw new Error('Open-Meteo saknar temperatur eller tryck för vald starttid.')
  }

  return {
    temperatureC: Math.round(temperatureC),
    qnhHpa: Math.round(pressureMslHpa),
    requestedTime,
  }
}
