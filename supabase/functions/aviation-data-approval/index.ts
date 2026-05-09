import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

type AviationDataUpdate = {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'failed'
  storage_bucket: string
  candidate_prefix: string
  current_prefix: string
  files: string[]
  approve_token_hash: string
  reject_token_hash: string
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    const id = url.searchParams.get('id')
    const token = url.searchParams.get('token')

    if ((action !== 'approve' && action !== 'reject') || !id || !token) {
      return jsonResponse({ error: 'Ogiltig approval-lank.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Funktionen saknar Supabase-konfiguration.')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await supabase
      .from('aviation_data_updates')
      .select('id, status, storage_bucket, candidate_prefix, current_prefix, files, approve_token_hash, reject_token_hash')
      .eq('id', id)
      .single()

    if (error || !data) {
      return htmlResponse('<h1>Uppdateringen hittades inte</h1>', 404)
    }

    const update = data as AviationDataUpdate
    if (update.status !== 'pending') {
      return htmlResponse(`<h1>Uppdateringen ar redan ${escapeHtml(update.status)}</h1>`, 409)
    }

    const tokenHash = await sha256Hex(token)
    const expectedHash = action === 'approve' ? update.approve_token_hash : update.reject_token_hash
    if (tokenHash !== expectedHash) {
      return htmlResponse('<h1>Token ar ogiltig</h1>', 403)
    }

    if (action === 'reject') {
      const { error: rejectError } = await supabase
        .from('aviation_data_updates')
        .update({ status: 'rejected', rejected_at: new Date().toISOString() })
        .eq('id', update.id)

      if (rejectError) {
        throw rejectError
      }

      return htmlResponse('<h1>Uppdateringen avvisades</h1><p>Ingen kartdata har andrats.</p>')
    }

    for (const fileName of update.files) {
      const sourcePath = `${update.candidate_prefix}/${fileName}`
      const targetPath = `${update.current_prefix}/${fileName}`
      const { data: sourceFile, error: downloadError } = await supabase.storage
        .from(update.storage_bucket)
        .download(sourcePath)

      if (downloadError || !sourceFile) {
        throw new Error(`Kunde inte lasa ${sourcePath}: ${downloadError?.message ?? 'saknas'}`)
      }

      const { error: uploadError } = await supabase.storage
        .from(update.storage_bucket)
        .upload(targetPath, sourceFile, {
          cacheControl: '60',
          contentType: 'application/json',
          upsert: true,
        })

      if (uploadError) {
        throw new Error(`Kunde inte skriva ${targetPath}: ${uploadError.message}`)
      }
    }

    const { error: approveError } = await supabase
      .from('aviation_data_updates')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', update.id)

    if (approveError) {
      throw approveError
    }

    return htmlResponse('<h1>Uppdateringen ar godkand</h1><p>Godkand data ar nu publicerad for appens kartdata.</p>')
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Okant fel i approval-funktionen.' },
      500,
    )
  }
})
