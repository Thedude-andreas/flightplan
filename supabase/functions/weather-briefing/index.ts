import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from './vendor/unpdf.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const sigmetListingUrl = 'https://www.aro.lfv.se/Links/Link/ShowFileList?type=MET&path=%5CAREA%5CSIGMET%5C&torlinkName=SIGMET%2FARS%2FAIRMET'
const cacheTtlMinutes = 20
const briefingKey = 'lfv-weather-briefing-v1'
const lhpAreas = [
  {
    id: 'se1',
    title: 'Område 1',
    sourceUrl: 'https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=310&type=MET',
  },
  {
    id: 'se2',
    title: 'Område 2',
    sourceUrl: 'https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=307&type=MET',
  },
  {
    id: 'se3',
    title: 'Område 3',
    sourceUrl: 'https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=308&type=MET',
  },
  {
    id: 'se4',
    title: 'Område 4',
    sourceUrl: 'https://www.aro.lfv.se/Links/Link/ViewLink?TorLinkId=309&type=MET',
  },
] as const

type CachedWindLevel = {
  label: string
  altitudeFt: number
  rawText: string
}

type CachedLhpArea = {
  id: 'se1' | 'se2' | 'se3' | 'se4'
  title: string
  sourceUrl: string
  overviewText: string | null
  areaText: string | null
  issuedAt: string | null
  validFrom: string | null
  validTo: string | null
  windLevels: CachedWindLevel[]
}

type CachedPayload = {
  sigmetSourceUrl: string | null
  sigmetPublishedAt: string | null
  sigmetText: string | null
  lhpAreas: CachedLhpArea[]
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

function normalizeWhitespace(value: string) {
  return value
    .replaceAll('\u0000', '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&aring;/gi, 'å')
    .replace(/&auml;/gi, 'ä')
    .replace(/&ouml;/gi, 'ö')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
  }

function stripPageArtifacts(value: string) {
  return value
    .replace(/Page of\s+\d+\s+\d+/gi, ' ')
    .replace(/SIGMET\/ARS\/AIRMET\s*\\/gi, ' ')
}

function stripHtml(value: string) {
  return normalizeWhitespace(
    decodeHtmlEntities(value)
      .replace(/<br[^>]*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|th|h1|h2|h3|li|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
}

async function extractPdfText(pdfBytes: Uint8Array) {
  const pdf = await getDocumentProxy(pdfBytes, {
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  })
  const { text } = await extractText(pdf, { mergePages: true })
  return normalizeWhitespace(stripPageArtifacts(text))
}

function extractSigmetPdfUrl(listingHtml: string) {
  const match = listingHtml.match(/href="(https:\/\/aro\.lfv\.se\/FileList\/AREA\/SIGMET\/\/[^"]+\.pdf)"/i)
  return match?.[1]?.replace(/ /g, '%20') ?? null
}

function parsePublishedAtFromFileUrl(sourceUrl: string | null) {
  if (!sourceUrl) {
    return null
  }

  const match = sourceUrl.match(/_(\d{8})(\d{6})\.pdf$/i)
  if (!match) {
    return null
  }

  const [, datePart, timePart] = match
  return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}Z`
}

function parseSwedishMonth(value: string) {
  return ({
    JANUARI: '01',
    FEBRUARI: '02',
    MARS: '03',
    APRIL: '04',
    MAJ: '05',
    JUNI: '06',
    JULI: '07',
    AUGUSTI: '08',
    SEPTEMBER: '09',
    OKTOBER: '10',
    NOVEMBER: '11',
    DECEMBER: '12',
  } as Record<string, string>)[value.toUpperCase()] ?? null
}

function parseLhpValidityDate(text: string | null) {
  if (!text) {
    return { validFrom: null, validTo: null }
  }

  const match = text.match(/GÄLLANDE DEN\s+(\d{1,2})\s+([A-ZÅÄÖ]+)\s+(\d{4})\s+MELLAN\s+(\d{2})\s+OCH\s+(\d{2})\s+UTC/i)
  if (!match) {
    return { validFrom: null, validTo: null }
  }

  const month = parseSwedishMonth(match[2])
  if (!month) {
    return { validFrom: null, validTo: null }
  }

  const date = `${match[3]}-${month}-${match[1].padStart(2, '0')}`
  return {
    validFrom: `${date}T${match[4]}:00:00Z`,
    validTo: `${date}T${match[5]}:00:00Z`,
  }
}

function parseIssuedAt(text: string | null) {
  if (!text) {
    return null
  }

  const issuedMatch = text.match(/UTFÄRDAD\s+(\d{2})(\d{2})(\d{2})/i)
  const validityMatch = text.match(/GÄLLANDE DEN\s+(\d{1,2})\s+([A-ZÅÄÖ]+)\s+(\d{4})/i)
  if (!issuedMatch || !validityMatch) {
    return null
  }

  const month = parseSwedishMonth(validityMatch[2])
  if (!month) {
    return null
  }

  return `${validityMatch[3]}-${month}-${validityMatch[1].padStart(2, '0')}T${issuedMatch[2]}:${issuedMatch[3]}:00Z`
}

function getAltitudeFt(label: string) {
  if (/^FL/i.test(label)) {
    return Number.parseInt(label.slice(2), 10) * 100
  }

  return Number.parseInt(label, 10)
}

function extractWindLevels(text: string | null) {
  if (!text) {
    return []
  }

  const matches = [...text.matchAll(/(?:^|\n)(2000ft|FL050|FL100):\n([\s\S]*?)(?=\n(?:2000ft|FL050|FL100):|$)/g)]
  return matches.map((match) => ({
    label: match[1].toUpperCase(),
    altitudeFt: getAltitudeFt(match[1].toUpperCase()),
    rawText: normalizeWhitespace(match[2]),
  }))
}

function extractPreBlocks(html: string) {
  return [...html.matchAll(/<pre[^>]*class="linkTextNormal"[^>]*>([\s\S]*?)<\/pre>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
}

async function extractLhpArea(area: typeof lhpAreas[number]): Promise<CachedLhpArea> {
  const response = await fetch(area.sourceUrl)
  if (!response.ok) {
    throw new Error(`LFV ${area.title} misslyckades (${response.status}).`)
  }

  const html = await response.text()
  const blocks = extractPreBlocks(html)
  const overviewText = blocks[0] ?? null
  const areaText = blocks.slice(1).join('\n\n') || null
  const validity = parseLhpValidityDate(overviewText)

  return {
    id: area.id,
    title: area.title,
    sourceUrl: area.sourceUrl,
    overviewText,
    areaText,
    issuedAt: parseIssuedAt(overviewText),
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    windLevels: extractWindLevels(areaText),
  }
}

async function buildFreshCacheEntry() {
  const sigmetListingResponse = await fetch(sigmetListingUrl)
  if (!sigmetListingResponse.ok) {
    throw new Error(`LFV SIGMET-listning misslyckades (${sigmetListingResponse.status}).`)
  }

  const sigmetListingHtml = await sigmetListingResponse.text()
  const sigmetSourceUrl = extractSigmetPdfUrl(sigmetListingHtml)
  if (!sigmetSourceUrl) {
    throw new Error('Kunde inte hitta aktuell LFV SIGMET/ARS/AIRMET-bulletin.')
  }

  const sigmetResponse = await fetch(sigmetSourceUrl)
  if (!sigmetResponse.ok) {
    throw new Error(`LFV SIGMET-bulletin misslyckades (${sigmetResponse.status}).`)
  }

  const sigmetText = await extractPdfText(new Uint8Array(await sigmetResponse.arrayBuffer()))
  const areas = await Promise.all(lhpAreas.map((area) => extractLhpArea(area)))

  return {
    sigmetSourceUrl,
    sigmetPublishedAt: parsePublishedAtFromFileUrl(sigmetSourceUrl),
    sigmetText,
    lhpAreas: areas,
  } satisfies CachedPayload
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const { forceRefresh } = await request.json().catch(() => ({})) as { forceRefresh?: boolean }

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

    const now = Date.now()
    const cachedAt = cachedRow?.fetched_at ? new Date(cachedRow.fetched_at).getTime() : 0
    const isFresh = !forceRefresh && cachedRow && now - cachedAt < cacheTtlMinutes * 60 * 1000

    const effectiveRow = isFresh
      ? cachedRow
      : await (async () => {
          try {
            const freshSections = await buildFreshCacheEntry()
            const { data, error } = await supabase
              .from('weather_briefing_cache')
              .upsert({
                briefing_key: briefingKey,
                fetched_at: new Date().toISOString(),
                sections: freshSections,
              }, { onConflict: 'briefing_key' })
              .select('fetched_at, sections')
              .single()

            if (error) {
              throw error
            }

            return data
          } catch (error) {
            if (cachedRow) {
              console.error('Using stale weather cache after refresh failed.', error)
              return cachedRow
            }

            throw error
          }
        })()

    const briefing = (effectiveRow.sections ?? {}) as Partial<CachedPayload>

    return jsonResponse({
      fetchedAt: effectiveRow.fetched_at,
      sigmetSourceUrl: briefing.sigmetSourceUrl ?? null,
      sigmetPublishedAt: briefing.sigmetPublishedAt ?? null,
      sigmetText: briefing.sigmetText ?? null,
      lhpAreas: briefing.lhpAreas ?? [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel'
    return jsonResponse({ error: message }, 500)
  }
})
