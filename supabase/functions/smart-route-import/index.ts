import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.101.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type SmartRouteImportPayload = {
  text?: string
  sourceType?: 'text' | 'spreadsheet' | 'pdf' | 'image' | 'file'
  fileName?: string
  fileType?: string
  fileSizeBytes?: number
  fileBase64?: string
}

type ParsedWaypoint = {
  raw: string
  name?: string | null
  lat?: number | null
  lon?: number | null
  notes?: string | null
  confidence?: number | null
}

type ParsedRoute = {
  routeName: string
  waypoints: ParsedWaypoint[]
  warnings: string[]
  confidence: number
}

type OpenAiUsage = {
  input_tokens?: number
  output_tokens?: number
  input_token_details?: {
    cached_tokens?: number
  }
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

function getEnv(name: string) {
  return Deno.env.get(name)?.trim() ?? ''
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function splitRouteText(value: string) {
  return value
    .replace(/\r/g, '\n')
    .split(/\s*(?:->|→|➜|=>|\n|;|\|)\s*|\s+-\s+|(?<=[A-ZÅÄÖa-zåäö0-9])-+(?=[A-ZÅÄÖa-zåäö0-9])/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseDecimalCoordinate(value: string) {
  const matches = [...value.matchAll(/([NS])?\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[, ]+\s*([EW])?\s*(-?\d{1,3}(?:[.,]\d+)?)/giu)]
  for (const match of matches) {
    const first = Number(match[2]?.replace(',', '.'))
    const second = Number(match[4]?.replace(',', '.'))
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      continue
    }

    let lat = first
    let lon = second
    if (match[1]?.toUpperCase() === 'S') lat = -Math.abs(lat)
    if (match[3]?.toUpperCase() === 'W') lon = -Math.abs(lon)
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon }
    }
  }

  return null
}

function fallbackParse(payload: SmartRouteImportPayload): ParsedRoute {
  const text = payload.text?.trim() ?? ''
  const parts = splitRouteText(text)
  const waypoints = (parts.length > 0 ? parts : text ? [text] : [])
    .slice(0, 40)
    .map((part) => {
      const coordinate = parseDecimalCoordinate(part)
      return {
        raw: part,
        name: coordinate ? null : part,
        lat: coordinate?.lat ?? null,
        lon: coordinate?.lon ?? null,
        confidence: coordinate ? 0.92 : 0.72,
      }
    })

  return {
    routeName: waypoints.map((point) => point.name ?? point.raw).join(' - ') || 'Importerad rutt',
    waypoints,
    warnings: waypoints.length < 2 ? ['Minst två punkter behövs för att skapa en rutt.'] : [],
    confidence: waypoints.length >= 2 ? 0.72 : 0.25,
  }
}

function stripCodeFence(value: string) {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function extractOutputText(response: Record<string, unknown>) {
  const outputText = response.output_text
  if (typeof outputText === 'string') {
    return outputText
  }

  const output = response.output
  if (!Array.isArray(output)) {
    return ''
  }

  const parts: string[] = []
  for (const item of output) {
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) {
      continue
    }

    for (const contentItem of content) {
      const text = (contentItem as { text?: unknown }).text
      if (typeof text === 'string') {
        parts.push(text)
      }
    }
  }

  return parts.join('\n')
}

function normalizeParsedRoute(value: unknown, fallbackName: string): ParsedRoute {
  const input = value as Partial<ParsedRoute>
  const waypoints = Array.isArray(input.waypoints)
    ? input.waypoints
      .map((point) => ({
        raw: String(point.raw ?? point.name ?? '').trim(),
        name: point.name ? String(point.name).trim() : null,
        lat: typeof point.lat === 'number' && Number.isFinite(point.lat) ? point.lat : null,
        lon: typeof point.lon === 'number' && Number.isFinite(point.lon) ? point.lon : null,
        notes: point.notes ? String(point.notes) : null,
        confidence: typeof point.confidence === 'number' ? clamp(point.confidence, 0, 1) : null,
      }))
      .filter((point) => point.raw || point.name || (point.lat != null && point.lon != null))
    : []

  return {
    routeName: typeof input.routeName === 'string' && input.routeName.trim() ? input.routeName.trim() : fallbackName,
    waypoints,
    warnings: Array.isArray(input.warnings) ? input.warnings.map(String).slice(0, 12) : [],
    confidence: typeof input.confidence === 'number' ? clamp(input.confidence, 0, 1) : 0.7,
  }
}

function createPrompt(payload: SmartRouteImportPayload) {
  return [
    'Du tolkar underlag för VFR-flygrutter. Returnera endast JSON.',
    'Extrahera ruttnamn, waypoints i ordning, koordinater om de finns, samt korta varningar.',
    'Hitta inte på koordinater. Om en punkt bara är ett namn, lämna lat/lon null.',
    'JSON-format: {"routeName":string,"waypoints":[{"raw":string,"name":string|null,"lat":number|null,"lon":number|null,"notes":string|null,"confidence":number}],"warnings":string[],"confidence":number}',
    `Källa: ${payload.sourceType ?? 'text'}`,
    payload.fileName ? `Filnamn: ${payload.fileName}` : '',
    'Text:',
    payload.text?.slice(0, 60000) ?? '',
  ].filter(Boolean).join('\n')
}

function estimateCostUsd(usage: OpenAiUsage, model: string) {
  const inputRate = Number(getEnv(`SMART_ROUTE_IMPORT_${model.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_INPUT_USD_PER_1M`))
    || Number(getEnv('SMART_ROUTE_IMPORT_INPUT_USD_PER_1M'))
    || 0.75
  const cachedInputRate = Number(getEnv('SMART_ROUTE_IMPORT_CACHED_INPUT_USD_PER_1M')) || inputRate * 0.1
  const outputRate = Number(getEnv('SMART_ROUTE_IMPORT_OUTPUT_USD_PER_1M')) || 4.5
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cachedTokens = usage.input_token_details?.cached_tokens ?? 0
  const uncachedTokens = Math.max(0, inputTokens - cachedTokens)

  return (uncachedTokens * inputRate + cachedTokens * cachedInputRate + outputTokens * outputRate) / 1_000_000
}

async function parseWithOpenAi(payload: SmartRouteImportPayload) {
  const apiKey = getEnv('OPENAI_API_KEY')
  if (!apiKey) {
    return {
      parsed: fallbackParse(payload),
      usage: { input_tokens: 0, output_tokens: 0 } satisfies OpenAiUsage,
      model: null,
      usedFallback: true,
    }
  }

  const model = getEnv('SMART_ROUTE_IMPORT_MODEL') || 'gpt-5.4-mini'
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: createPrompt(payload) }]
  if (payload.fileBase64 && payload.fileType?.startsWith('image/')) {
    content.push({
      type: 'input_image',
      image_url: `data:${payload.fileType};base64,${payload.fileBase64}`,
      detail: 'high',
    })
  } else if (payload.fileBase64 && payload.fileType === 'application/pdf') {
    content.push({
      type: 'input_file',
      filename: payload.fileName || 'route.pdf',
      file_data: `data:application/pdf;base64,${payload.fileBase64}`,
    })
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{
        role: 'user',
        content,
      }],
      max_output_tokens: 1800,
    }),
  })

  const data = await response.json() as Record<string, unknown>
  if (!response.ok) {
    throw new Error(typeof data.error === 'object' && data.error && 'message' in data.error
      ? String((data.error as { message: unknown }).message)
      : `OpenAI-förfrågan misslyckades (${response.status}).`)
  }

  const outputText = stripCodeFence(extractOutputText(data))
  const parsedJson = JSON.parse(outputText) as unknown

  return {
    parsed: normalizeParsedRoute(parsedJson, payload.fileName ?? 'Importerad rutt'),
    usage: (data.usage ?? {}) as OpenAiUsage,
    model,
    usedFallback: false,
  }
}

async function insertLog(
  ownerUserId: string,
  payload: SmartRouteImportPayload,
  result: ParsedRoute | null,
  usage: OpenAiUsage,
  model: string | null,
  errorMessage: string | null,
) {
  if (!ownerUserId) {
    return
  }

  const supabaseUrl = getEnv('SUPABASE_URL')
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return
  }

  const client = createClient(supabaseUrl, serviceRoleKey)
  const cost = model ? estimateCostUsd(usage, model) : 0
  const { error } = await client.from('smart_route_import_logs').insert({
    owner_user_id: ownerUserId,
    source_type: payload.sourceType ?? 'text',
    file_name: payload.fileName ?? null,
    file_type: payload.fileType ?? null,
    file_size_bytes: payload.fileSizeBytes ?? null,
    model,
    input_tokens: usage.input_tokens ?? 0,
    cached_input_tokens: usage.input_token_details?.cached_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    estimated_cost_usd: cost,
    success: Boolean(result && !errorMessage),
    confidence: result?.confidence ?? null,
    waypoint_count: result?.waypoints.length ?? 0,
    warnings: result?.warnings ?? [],
    error_message: errorMessage,
  })

  if (error) {
    console.error('Unable to insert smart route import log', error)
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = request.headers.get('Authorization') ?? ''
  let ownerUserId = ''
  let payload: SmartRouteImportPayload = {}
  let usage: OpenAiUsage = {}
  let model: string | null = null
  let parsed: ParsedRoute | null = null

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const anonKey = getEnv('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase är inte konfigurerat för funktionen.')
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await authClient.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'Ingen aktiv användare.' }, 401)
    }
    ownerUserId = user.id

    payload = (await request.json()) as SmartRouteImportPayload
    const hasInput = Boolean(payload.text?.trim() || payload.fileBase64)
    if (!hasInput) {
      return jsonResponse({ error: 'Klistra in text eller välj en fil.' }, 400)
    }

    if ((payload.fileSizeBytes ?? 0) > 8 * 1024 * 1024) {
      return jsonResponse({ error: 'Filen är för stor för smart ruttimport i testläget.' }, 413)
    }

    const result = await parseWithOpenAi(payload)
    parsed = result.parsed
    usage = result.usage
    model = result.model

    if (parsed.waypoints.length < 2) {
      parsed.warnings = [...parsed.warnings, 'Minst två punkter behövs för att skapa en rutt.']
    }

    await insertLog(ownerUserId, payload, parsed, usage, model, null)

    return jsonResponse({
      ...parsed,
      diagnostics: {
        model,
        usedFallback: result.usedFallback,
        usage,
        estimatedCostUsd: model ? estimateCostUsd(usage, model) : 0,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel vid smart ruttimport.'
    await insertLog(ownerUserId, payload, parsed, usage, model, message)
    return jsonResponse({ error: message }, 500)
  }
})
