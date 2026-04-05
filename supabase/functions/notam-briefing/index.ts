import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from './vendor/unpdf.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const cacheTtlMinutes = 30
const briefingKey = 'lfv-esaa-fir-vfr-24hr-v2'
const listingUrl = 'https://www.aro.lfv.se/Links/Link/ShowFileList?path=%5Cpibsweden%5C&torlinkName=NOTAM+Sweden&type=AIS'

type CachedSections = Record<string, {
  airportName: string | null
  rawText: string | null
  hasNotams: boolean
}>

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdfText(pdfBytes: Uint8Array) {
  const pdf = await getDocumentProxy(pdfBytes, {
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  })
  const { text } = await extractText(pdf, { mergePages: true })
  return normalizeWhitespace(text)
}

function extractCurrentBulletinUrl(listingHtml: string) {
  const matches = [...listingHtml.matchAll(/href="(https:\/\/aro\.lfv\.se\/FileList\/pibsweden\/\/ESAA(?:%20| )FIR(?:%20| )VFR(?:%20| )24hr_[^"]+\.pdf)"/gi)]
  const url = matches[0]?.[1]
  if (!url) {
    throw new Error('Kunde inte hitta aktuell LFV VFR-briefing.')
  }

  return url.replace(/ /g, '%20')
}

function extractAirportSections(pdfText: string): CachedSections {
  const sections: CachedSections = {}
  const aerodromesIndex = pdfText.indexOf('AERODROMES ')
  if (aerodromesIndex < 0) {
    return sections
  }

  const relevantText = pdfText
    .slice(aerodromesIndex + 'AERODROMES '.length)
    .replace(/Page of\d+ \d+(?: [A-Z]\d{4}\/\d{2})+/g, ' ')
    .replace(/Page of\d+ \d+/g, ' ')

  const matches = [...relevantText.matchAll(/\b([A-Z]{4}) - /g)]

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const icao = match[1]
    const sectionStart = match.index ?? 0
    const sectionEnd = matches[index + 1]?.index ?? relevantText.length
    const sectionText = normalizeWhitespace(relevantText.slice(sectionStart, sectionEnd))

    if (/^(EN-ROUTE|WARNINGS|MISCELLANEOUS)\b/i.test(sectionText)) {
      break
    }

    const withoutPrefix = sectionText.replace(new RegExp(`^${icao} -\\s*`), '')
    const markerMatches = [
      withoutPrefix.indexOf(' + '),
      withoutPrefix.indexOf(' SNOWTAM '),
      withoutPrefix.indexOf(' No information received or matching the query'),
    ].filter((position) => position >= 0)
    const nameEnd = markerMatches.length > 0 ? Math.min(...markerMatches) : withoutPrefix.length
    const airportName = normalizeWhitespace(withoutPrefix.slice(0, nameEnd)) || null
    const rawText = normalizeWhitespace(withoutPrefix.slice(nameEnd)) || null

    sections[icao] = {
      airportName,
      rawText,
      hasNotams: Boolean(rawText) && !/No information received or matching the query/i.test(rawText),
    }
  }

  return sections
}

function parsePublishedAtFromBulletinUrl(sourceUrl: string) {
  const match = sourceUrl.match(/_(\d{8})(\d{6})\.pdf$/i)
  if (!match) {
    return null
  }

  const [, datePart, timePart] = match
  const iso = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}Z`
  return iso
}

async function buildFreshCacheEntry() {
  const listingResponse = await fetch(listingUrl)
  if (!listingResponse.ok) {
    throw new Error(`LFV-listning misslyckades (${listingResponse.status}).`)
  }

  const listingHtml = await listingResponse.text()
  const sourceUrl = extractCurrentBulletinUrl(listingHtml)

  const pdfResponse = await fetch(sourceUrl)
  if (!pdfResponse.ok) {
    throw new Error(`LFV-PDF misslyckades (${pdfResponse.status}).`)
  }

  const pdfText = await extractPdfText(new Uint8Array(await pdfResponse.arrayBuffer()))
  const sections = extractAirportSections(pdfText)

  return {
    briefing_key: briefingKey,
    source_url: sourceUrl,
    bulletin_published_at: parsePublishedAtFromBulletinUrl(sourceUrl),
    fetched_at: new Date().toISOString(),
    sections,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const { icaos, forceRefresh } = await request.json() as { icaos?: string[]; forceRefresh?: boolean }
    const normalizedIcaos = Array.from(new Set((icaos ?? []).filter((value): value is string => typeof value === 'string').map((value) => value.trim().toUpperCase())))

    if (normalizedIcaos.length === 0) {
      return jsonResponse({
        sourceUrl: null,
        fetchedAt: null,
        bulletinPublishedAt: null,
        notams: [],
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase function saknar service role-konfiguration.')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: cachedRow, error: cachedError } = await supabase
      .from('notam_briefing_cache')
      .select('source_url, fetched_at, bulletin_published_at, sections')
      .eq('briefing_key', briefingKey)
      .maybeSingle()

    if (cachedError) {
      throw cachedError
    }

    const now = Date.now()
    const cachedAt = cachedRow?.fetched_at ? new Date(cachedRow.fetched_at).getTime() : 0
    const isFresh = !forceRefresh && cachedRow && now - cachedAt < cacheTtlMinutes * 60 * 1000

    const effectiveRow = isFresh
      ? cachedRow
      : await (async () => {
          const freshEntry = await buildFreshCacheEntry()
          const { data, error } = await supabase
            .from('notam_briefing_cache')
            .upsert(freshEntry, { onConflict: 'briefing_key' })
            .select('source_url, fetched_at, bulletin_published_at, sections')
            .single()

          if (error) {
            throw error
          }

          return data
        })()

    const sections = (effectiveRow.sections ?? {}) as CachedSections
    const notams = normalizedIcaos.map((icao) => ({
      icao,
      airportName: sections[icao]?.airportName ?? null,
      rawText: sections[icao]?.rawText ?? null,
      hasNotams: sections[icao]?.hasNotams ?? false,
    }))

    return jsonResponse({
      sourceUrl: effectiveRow.source_url,
      fetchedAt: effectiveRow.fetched_at,
      bulletinPublishedAt: effectiveRow.bulletin_published_at,
      notams,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel'
    return jsonResponse({ error: message }, 500)
  }
})
