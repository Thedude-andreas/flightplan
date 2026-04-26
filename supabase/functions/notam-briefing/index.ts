import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from './vendor/unpdf.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const cacheTtlMinutes = 30
const briefingKey = 'lfv-esaa-fir-vfr-24hr-v3'
const listingUrl = 'https://www.aro.lfv.se/Links/Link/ShowFileList?path=%5Cpibsweden%5C&torlinkName=NOTAM+Sweden&type=AIS'
const eAipIndexUrl = 'https://aro.lfv.se/content/eaip/default_offline.html'
const eAipBaseUrl = 'https://aro.lfv.se/content/eaip/'
const eAipDatasourcePath = 'v2/js/datasource.js'

type CachedSections = Record<string, {
  airportName: string | null
  rawText: string | null
  hasNotams: boolean
}>

type CachedSupplement = {
  id: string
  title: string
  source: 'eaip-datasource' | 'trigger-notam'
  url: string | null
  periodText: string | null
  validFrom: string | null
  validTo: string | null
  rawText: string | null
}

type CachedPayload = {
  airports: CachedSections
  enRouteText: string | null
  warningsText: string | null
  supplementSourceUrl: string | null
  supplements: CachedSupplement[]
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
    .replace(/\s+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripPageArtifacts(value: string) {
  return value
    .replace(/Page of\s+\d+\s+\d+(?:\s+[A-Z]\d{4}\/\d{2})+/gi, ' ')
    .replace(/Page of\s+\d+\s+\d+/gi, ' ')
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function stripHtml(value: string) {
  return normalizeWhitespace(
    decodeHtmlEntities(value)
      .replace(/<br[^>]*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|th|h1|h2|h3|li)>/gi, '\n')
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

function extractCurrentBulletinUrl(listingHtml: string) {
  const matches = [...listingHtml.matchAll(/href="(https:\/\/aro\.lfv\.se\/FileList\/pibsweden\/\/ESAA(?:%20| )FIR(?:%20| )VFR(?:%20| )24hr_[^"]+\.pdf)"/gi)]
  const url = matches[0]?.[1]
  if (!url) {
    throw new Error('Kunde inte hitta aktuell LFV VFR-briefing.')
  }

  return url.replace(/ /g, '%20')
}

function extractSectionText(pdfText: string, sectionLabel: string, nextLabels: string[]) {
  const sectionStart = pdfText.indexOf(sectionLabel)
  if (sectionStart < 0) {
    return null
  }

  const contentStart = sectionStart + sectionLabel.length
  const contentEnd = nextLabels
    .map((label) => pdfText.indexOf(label, contentStart))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? pdfText.length

  return normalizeWhitespace(pdfText.slice(contentStart, contentEnd)) || null
}

function extractAirportSections(aerodromesText: string | null): CachedSections {
  const sections: CachedSections = {}

  if (!aerodromesText) {
    return sections
  }

  const matches = [...aerodromesText.matchAll(/\b([A-Z]{4}) - /g)]

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const icao = match[1]
    const sectionStart = match.index ?? 0
    const sectionEnd = matches[index + 1]?.index ?? aerodromesText.length
    const sectionText = normalizeWhitespace(aerodromesText.slice(sectionStart, sectionEnd))
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
  return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}Z`
}

function extractCurrentEaipRootUrl(indexHtml: string) {
  const match = indexHtml.match(/href="([^"]*AIRAC AIP AMDT [^"]*index-v2\.html)"/i)
  const issuePath = match?.[1]
  if (!issuePath) {
    return null
  }

  const normalizedPath = issuePath.replace(/\\/g, '/').replace(/ /g, '%20')
  return new URL(normalizedPath.replace(/index-v2\.html$/i, ''), eAipBaseUrl).toString()
}

function parseMonthToken(value: string) {
  return ({
    JAN: '01',
    FEB: '02',
    MAR: '03',
    APR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08',
    SEP: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12',
  } as Record<string, string>)[value.toUpperCase()] ?? null
}

function parseDayMonthYear(value: string) {
  const match = value.match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/i)
  if (!match) {
    return null
  }

  const month = parseMonthToken(match[2])
  if (!month) {
    return null
  }

  return `${match[3]}-${month}-${match[1].padStart(2, '0')}`
}

function parsePeriodText(periodText: string | null) {
  if (!periodText) {
    return { validFrom: null, validTo: null }
  }

  const fromMatch = periodText.match(/from\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i)
  const toMatch = periodText.match(/to\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4}|PERM|UFN)/i)

  return {
    validFrom: fromMatch ? parseDayMonthYear(fromMatch[1]) : null,
    validTo:
      toMatch && !/PERM|UFN/i.test(toMatch[1])
        ? parseDayMonthYear(toMatch[1])
        : null,
  }
}

function parseDatasourceObject(source: string) {
  const assignmentIndex = source.indexOf('{')
  const trailingIndex = source.lastIndexOf('};')
  if (assignmentIndex < 0 || trailingIndex < assignmentIndex) {
    return null
  }

  return JSON.parse(source.slice(assignmentIndex, trailingIndex + 1)) as {
    tabs?: Array<{
      id?: number
      contents?: Record<string, {
        table?: {
          rows?: Array<{
            year?: { text?: string; href?: string }
            period?: { text?: string }
            subject?: { text?: string }
          }>
        }
      }>
    }>
  }
}

async function mapWithConcurrencyLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results: R[] = Array.from({ length: values.length }) as R[]
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(values[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

async function extractDatasourceSupplements(eAipRootUrl: string) {
  const datasourceUrl = new URL(eAipDatasourcePath, eAipRootUrl).toString()
  const datasourceResponse = await fetch(datasourceUrl)
  if (!datasourceResponse.ok) {
    throw new Error(`LFV datasource misslyckades (${datasourceResponse.status}).`)
  }

  const datasource = parseDatasourceObject(await datasourceResponse.text())
  const rows = datasource?.tabs?.find((tab) => tab.id === 3)?.contents?.['en-GB']?.table?.rows ?? []

  const supplements = rows
    .map((row) => {
      const yearText = normalizeWhitespace(row.year?.text ?? '')
      const href = row.year?.href?.replace(/#.*/, '') ?? null
      const periodText = normalizeWhitespace(row.period?.text ?? '') || null
      const subject = stripHtml(row.subject?.text ?? '') || yearText
      const idMatch = yearText.match(/(\d+\/\d{4})/)

      if (!idMatch || !href || /Checklist/i.test(yearText)) {
        return null
      }

      const validity = parsePeriodText(periodText)

      return {
        id: idMatch[1],
        title: subject,
        source: 'eaip-datasource' as const,
        url: new URL(`eSUP/${href}`, eAipRootUrl).toString(),
        periodText,
        validFrom: validity.validFrom,
        validTo: validity.validTo,
      }
    })
    .filter((value): value is Omit<CachedSupplement, 'rawText'> => Boolean(value))

  return mapWithConcurrencyLimit(supplements, 6, async (supplement) => {
    try {
      const response = await fetch(supplement.url as string)
      if (!response.ok) {
        return {
          ...supplement,
          rawText: null,
        }
      }

      const html = await response.text()
      return {
        ...supplement,
        rawText: stripHtml(html),
      }
    } catch {
      return {
        ...supplement,
        rawText: null,
      }
    }
  })
}

function extractTriggerSupplements(...texts: Array<string | null>) {
  return Array.from(new Set(
    texts
      .flatMap((text) => [...(text ?? '').matchAll(/\bAIP\s+SUP\s+(\d+\/\d{4})\b/gi)].map((match) => match[1])),
  )).map((id) => ({
    id,
    title: `AIP SUP ${id}`,
    source: 'trigger-notam' as const,
    url: null,
    periodText: null,
    validFrom: null,
    validTo: null,
    rawText: null,
  }))
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
  const aerodromesText = extractSectionText(pdfText, 'AERODROMES ', ['EN-ROUTE ', 'NAV WARNINGS ', 'MISCELLANEOUS '])
  const enRouteText = extractSectionText(pdfText, 'EN-ROUTE ', ['NAV WARNINGS ', 'MISCELLANEOUS '])
  const warningsText = extractSectionText(pdfText, 'NAV WARNINGS ', ['MISCELLANEOUS '])

  let supplementSourceUrl: string | null = null
  let supplements: CachedSupplement[] = extractTriggerSupplements(enRouteText, warningsText)

  try {
    const eAipIndexResponse = await fetch(eAipIndexUrl)
    if (eAipIndexResponse.ok) {
      const eAipIndexHtml = await eAipIndexResponse.text()
      const eAipRootUrl = extractCurrentEaipRootUrl(eAipIndexHtml)
      if (eAipRootUrl) {
        supplementSourceUrl = new URL(eAipDatasourcePath, eAipRootUrl).toString()
        const datasourceSupplements = await extractDatasourceSupplements(eAipRootUrl)
        const supplementMap = new Map<string, CachedSupplement>()

        for (const supplement of [...datasourceSupplements, ...supplements]) {
          if (!supplementMap.has(supplement.id) || supplement.source === 'eaip-datasource') {
            supplementMap.set(supplement.id, supplement)
          }
        }

        supplements = Array.from(supplementMap.values())
      }
    }
  } catch {
    // Supplement parsing is best-effort; NOTAM briefing should still work without eAIP.
  }

  return {
    briefing_key: briefingKey,
    source_url: sourceUrl,
    bulletin_published_at: parsePublishedAtFromBulletinUrl(sourceUrl),
    fetched_at: new Date().toISOString(),
    sections: {
      airports: extractAirportSections(aerodromesText),
      enRouteText,
      warningsText,
      supplementSourceUrl,
      supplements,
    } satisfies CachedPayload,
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
    const normalizedIcaos = Array.from(new Set(
      (icaos ?? [])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toUpperCase()),
    ))

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
          try {
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
          } catch (error) {
            if (cachedRow) {
              console.error('Using stale NOTAM cache after refresh failed.', error)
              return cachedRow
            }

            throw error
          }
        })()

    const sections = (effectiveRow.sections ?? {}) as Partial<CachedPayload>
    const airports = sections.airports ?? {}

    return jsonResponse({
      sourceUrl: effectiveRow.source_url,
      fetchedAt: effectiveRow.fetched_at,
      bulletinPublishedAt: effectiveRow.bulletin_published_at,
      enRouteText: sections.enRouteText ?? null,
      warningsText: sections.warningsText ?? null,
      supplementSourceUrl: sections.supplementSourceUrl ?? null,
      supplements: sections.supplements ?? [],
      notams: normalizedIcaos.map((icao) => ({
        icao,
        airportName: airports[icao]?.airportName ?? null,
        rawText: airports[icao]?.rawText ?? null,
        hasNotams: airports[icao]?.hasNotams ?? false,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel'
    return jsonResponse({ error: message }, 500)
  }
})
