const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type RegistryLookupPayload = {
  registration?: string
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

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function stripHtml(value: string) {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function parseNumber(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function buildCookieHeader(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const rawCookies = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : []

  return rawCookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

function extractVerificationToken(html: string) {
  const match = html.match(/__RequestVerificationToken" type="hidden" value="([^"]+)"/)
  return match?.[1] ?? null
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractRow(tableHtml: string, label: string) {
  const expression = new RegExp(`<tr>\\s*<td[^>]*><strong>${escapeRegExp(label)}<\\/strong><\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>\\s*<\\/tr>`, 'i')
  const match = tableHtml.match(expression)
  return match ? stripHtml(match[1]) : ''
}

function extractOwners(html: string, label: string) {
  const ownersSection = html.match(new RegExp(`<label class="owner-headline">${label}<\\/label><br \\/>([\\s\\S]*?)(?:<br \\/><br \\/>|<label class="owner-headline">|<\\/div>)`, 'i'))?.[1] ?? ''
  const matches = [...ownersSection.matchAll(/<strong>(.*?)<\/strong>/gi)]
  return matches.map((match) => stripHtml(match[1])).filter(Boolean)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const { registration } = (await request.json()) as RegistryLookupPayload
    const normalizedRegistration = registration?.trim().toUpperCase().replace(/^SE[- ]?/, 'SE-')

    if (!normalizedRegistration || !/^SE-[A-Z0-9]{3,5}$/.test(normalizedRegistration)) {
      return jsonResponse({ error: 'Ogiltig registrering.' }, 400)
    }

    const registrationSuffix = normalizedRegistration.replace(/^SE-/, '')
    const baseUrl = 'https://etjanster-luftfart.transportstyrelsen.se/en-gb/sokluftfartyg'
    const pageResponse = await fetch(baseUrl)
    const pageHtml = await pageResponse.text()
    const verificationToken = extractVerificationToken(pageHtml)
    const cookieHeader = buildCookieHeader(pageResponse.headers)

    if (!verificationToken) {
      throw new Error('Kunde inte läsa verifieringstoken från Transportstyrelsen.')
    }

    const body = new URLSearchParams({
      __RequestVerificationToken: verificationToken,
      selection: 'regno',
      regno: registrationSuffix,
      owner: '',
      part: '',
      item: '',
    })

    const resultResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body,
    })
    const resultHtml = await resultResponse.text()

    const tableHtml = resultHtml.match(/<table class="table">([\s\S]*?)<\/table>/i)?.[0]
    if (!tableHtml) {
      return jsonResponse({ error: `Ingen träff för ${normalizedRegistration}.` }, 404)
    }

    const aircraftType = extractRow(tableHtml, 'Aircraft type')
    const [manufacturer, ...modelParts] = aircraftType.split('-')
    const registeredOperator = extractOwners(resultHtml, 'Registered operator')[0] ?? ''

    return jsonResponse({
      registration: normalizedRegistration,
      manufacturer: manufacturer?.trim() ?? '',
      model: modelParts.length > 0 ? modelParts.join('-').trim() : aircraftType,
      serialNumber: extractRow(tableHtml, 'Serial number'),
      yearOfManufacture: parseNumber(extractRow(tableHtml, 'Year built')),
      maxTakeoffWeightKg: parseNumber(extractRow(tableHtml, 'Maximum take-off mass (kg)')),
      registeredOwners: extractOwners(resultHtml, 'Registered owner'),
      registeredOperator,
      airworthinessExpiresOn: extractRow(tableHtml, 'Airworthiness expire') || null,
      registrationDate: extractRow(tableHtml, 'Registration date') || null,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Okänt fel vid registeruppslag.',
    }, 500)
  }
})
