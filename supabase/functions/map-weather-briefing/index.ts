import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const aviationWeatherBaseUrl = 'https://aviationweather.gov/api/data'
const briefingKey = 'map-weather-briefing-v1'
const metarTtlMinutes = 2
const tafTtlMinutes = 10
const aviationWeatherBatchSize = 80

type AirportWeatherReport = {
  metarRawText: string | null
  metarObservedAt: string | null
  tafRawText: string | null
  tafIssuedAt: string | null
  fetchedAt: string
  tafFetchedAt: string | null
}

type CachedPayload = {
  airports?: Record<string, AirportWeatherReport>
}

type MetarApiEntry = {
  icaoId?: string
  obsTime?: number | string | null
  reportTime?: string | null
  rawOb?: string | null
}

type TafApiEntry = {
  icaoId?: string
  issueTime?: string | null
  bulletinTime?: string | null
  rawTAF?: string | null
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

function normalizeIcaos(values: unknown) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^[A-Z]{4}$/.test(value)),
  ))
}

function parseTimestampToMs(value: string | number | null | undefined) {
  if (value == null) {
    return 0
  }

  if (typeof value === 'number') {
    return value >= 1e12 ? value : value * 1000
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function timestampToIso(value: string | number | null | undefined) {
  const ms = parseTimestampToMs(value)
  return ms > 0 ? new Date(ms).toISOString() : null
}

function isReportFresh(report: AirportWeatherReport | undefined, includeTaf: boolean, now: number) {
  if (!report) {
    return false
  }

  const metarFetchedAt = Date.parse(report.fetchedAt)
  if (Number.isNaN(metarFetchedAt) || now - metarFetchedAt > metarTtlMinutes * 60 * 1000) {
    return false
  }

  if (!includeTaf) {
    return true
  }

  const tafFetchedAt = report.tafFetchedAt ? Date.parse(report.tafFetchedAt) : 0
  return tafFetchedAt > 0 && now - tafFetchedAt <= tafTtlMinutes * 60 * 1000
}

function latestMetarsByIcao(entries: MetarApiEntry[]) {
  const byIcao = new Map<string, MetarApiEntry>()

  for (const entry of entries) {
    const icao = entry.icaoId?.trim().toUpperCase()
    if (!icao) {
      continue
    }

    const current = byIcao.get(icao)
    if (!current || parseTimestampToMs(entry.obsTime ?? entry.reportTime) > parseTimestampToMs(current.obsTime ?? current.reportTime)) {
      byIcao.set(icao, entry)
    }
  }

  return byIcao
}

function tafsByIcao(entries: TafApiEntry[]) {
  const byIcao = new Map<string, TafApiEntry>()

  for (const entry of entries) {
    const icao = entry.icaoId?.trim().toUpperCase()
    if (!icao) {
      continue
    }

    const current = byIcao.get(icao)
    if (!current || parseTimestampToMs(entry.issueTime ?? entry.bulletinTime) > parseTimestampToMs(current.issueTime ?? current.bulletinTime)) {
      byIcao.set(icao, entry)
    }
  }

  return byIcao
}

async function fetchAviationWeatherJson<T>(path: string, icaos: string[]) {
  const params = new URLSearchParams({
    ids: icaos.join(','),
    format: 'json',
  })

  if (path === 'metar') {
    params.set('taf', 'false')
    params.set('hours', '2')
  } else {
    params.set('metar', 'false')
  }

  const response = await fetch(`${aviationWeatherBaseUrl}/${path}?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`AviationWeather ${path.toUpperCase()} misslyckades (${response.status}).`)
  }

  return await response.json() as T
}

async function fetchAviationWeatherJsonBatched<T>(path: string, icaos: string[]) {
  const batches: string[][] = []
  for (let index = 0; index < icaos.length; index += aviationWeatherBatchSize) {
    batches.push(icaos.slice(index, index + aviationWeatherBatchSize))
  }

  const results = await Promise.all(batches.map((batch) => fetchAviationWeatherJson<T[]>(path, batch)))
  return results.flat()
}

async function fetchFreshReports(
  icaos: string[],
  includeTaf: boolean,
  existing: Record<string, AirportWeatherReport>,
) {
  if (icaos.length === 0) {
    return {}
  }

  const fetchedAt = new Date().toISOString()
  const [metarEntries, tafEntries] = await Promise.all([
    fetchAviationWeatherJsonBatched<MetarApiEntry>('metar', icaos),
    includeTaf ? fetchAviationWeatherJsonBatched<TafApiEntry>('taf', icaos) : Promise.resolve([]),
  ])
  const metars = latestMetarsByIcao(metarEntries)
  const tafs = tafsByIcao(tafEntries)
  const reports: Record<string, AirportWeatherReport> = {}

  for (const icao of icaos) {
    const metar = metars.get(icao)
    const taf = tafs.get(icao)
    const previous = existing[icao]

    reports[icao] = {
      metarRawText: metar?.rawOb ?? null,
      metarObservedAt: timestampToIso(metar?.obsTime ?? metar?.reportTime),
      tafRawText: includeTaf ? taf?.rawTAF ?? null : previous?.tafRawText ?? null,
      tafIssuedAt: includeTaf ? timestampToIso(taf?.issueTime ?? taf?.bulletinTime) : previous?.tafIssuedAt ?? null,
      fetchedAt,
      tafFetchedAt: includeTaf ? fetchedAt : previous?.tafFetchedAt ?? null,
    }
  }

  return reports
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const body = await request.json().catch(() => ({})) as { icaos?: unknown; includeTaf?: boolean; forceRefresh?: boolean }
    const icaos = normalizeIcaos(body.icaos)
    const includeTaf = Boolean(body.includeTaf)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase function saknar service role-konfiguration.')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: cachedRow, error: cachedError } = await supabase
      .from('weather_briefing_cache')
      .select('fetched_at, sections')
      .eq('briefing_key', briefingKey)
      .maybeSingle()

    if (cachedError) {
      throw cachedError
    }

    const cachedSections = (cachedRow?.sections ?? {}) as CachedPayload
    const cachedAirports = cachedSections.airports ?? {}
    const now = Date.now()
    const missingOrStaleIcaos = body.forceRefresh
      ? icaos
      : icaos.filter((icao) => !isReportFresh(cachedAirports[icao], includeTaf, now))
    const freshReports = await fetchFreshReports(missingOrStaleIcaos, includeTaf, cachedAirports)
    const airports = {
      ...cachedAirports,
      ...freshReports,
    }

    if (missingOrStaleIcaos.length > 0) {
      const { error } = await supabase
        .from('weather_briefing_cache')
        .upsert({
          briefing_key: briefingKey,
          fetched_at: new Date().toISOString(),
          sections: { airports } satisfies CachedPayload,
        }, { onConflict: 'briefing_key' })

      if (error) {
        throw error
      }
    }

    return jsonResponse({
      fetchedAt: new Date().toISOString(),
      includeTaf,
      airports: icaos.map((icao) => ({
        icao,
        metarRawText: airports[icao]?.metarRawText ?? null,
        metarObservedAt: airports[icao]?.metarObservedAt ?? null,
        tafRawText: includeTaf ? airports[icao]?.tafRawText ?? null : null,
        tafIssuedAt: includeTaf ? airports[icao]?.tafIssuedAt ?? null : null,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel'
    return jsonResponse({ error: message }, 500)
  }
})
