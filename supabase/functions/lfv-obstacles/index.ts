const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const lfvWfsUrl = 'https://daim.lfv.se/geoserver/wfs'
const defaultMaxFeatures = 2500

type RequestBounds = {
  south?: unknown
  west?: unknown
  north?: unknown
  east?: unknown
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function parseBounds(value: RequestBounds | undefined) {
  const south = numberValue(value?.south)
  const west = numberValue(value?.west)
  const north = numberValue(value?.north)
  const east = numberValue(value?.east)

  if (south == null || west == null || north == null || east == null) {
    throw new Error('bounds måste innehålla south, west, north och east.')
  }

  return {
    south: clamp(Math.min(south, north), -90, 90),
    west: clamp(Math.min(west, east), -180, 180),
    north: clamp(Math.max(south, north), -90, 90),
    east: clamp(Math.max(west, east), -180, 180),
  }
}

function normalizeMaxFeatures(value: unknown) {
  const parsed = numberValue(value)
  if (parsed == null) {
    return defaultMaxFeatures
  }

  return Math.max(1, Math.min(5000, Math.round(parsed)))
}

function buildLfvUrl(bounds: ReturnType<typeof parseBounds>, maxFeatures: number) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typeName: 'mais:OBSE',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    maxFeatures: String(maxFeatures),
    bbox: [
      bounds.west.toFixed(6),
      bounds.south.toFixed(6),
      bounds.east.toFixed(6),
      bounds.north.toFixed(6),
      'EPSG:4326',
    ].join(','),
  })

  return `${lfvWfsUrl}?${params.toString()}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const body = await request.json().catch(() => ({})) as { bounds?: RequestBounds; maxFeatures?: unknown }
    const bounds = parseBounds(body.bounds)
    const maxFeatures = normalizeMaxFeatures(body.maxFeatures)
    const response = await fetch(buildLfvUrl(bounds, maxFeatures), {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`LFV WFS svarade ${response.status}.`)
    }

    return jsonResponse(await response.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
