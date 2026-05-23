type OpenMeteoElevationResponse = {
  elevation?: number[]
  error?: boolean
  reason?: string
}

export async function fetchOpenMeteoElevationFt(
  point: { lat: number; lon: number },
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    latitude: String(point.lat),
    longitude: String(point.lon),
  })
  const response = await fetch(`https://api.open-meteo.com/v1/elevation?${params.toString()}`, { signal })

  if (!response.ok) {
    throw new Error(`Open-Meteo elevation svarade ${response.status}.`)
  }

  const data = (await response.json()) as OpenMeteoElevationResponse
  if (data.error) {
    throw new Error(data.reason ?? 'Open-Meteo elevation kunde inte hämta höjd.')
  }

  const elevationMeters = data.elevation?.[0]
  if (typeof elevationMeters !== 'number' || !Number.isFinite(elevationMeters)) {
    throw new Error('Open-Meteo elevation saknar höjd för startplatsen.')
  }

  return Math.round(elevationMeters * 3.28084)
}
