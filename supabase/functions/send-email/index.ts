const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${name}.`)
  }

  return value.trim()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      throw new Error('Missing RESEND_API_KEY.')
    }

    const payload = await request.json()
    const from = requireString(payload.from ?? Deno.env.get('APP_FROM_EMAIL'), 'from')
    const to = requireString(payload.to, 'to')
    const subject = requireString(payload.subject, 'subject')
    const html = requireString(payload.html, 'html')

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    })

    if (!response.ok) {
      return jsonResponse({ error: await response.text() }, response.status)
    }

    return jsonResponse(await response.json())
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown send-email error.' },
      500,
    )
  }
})
