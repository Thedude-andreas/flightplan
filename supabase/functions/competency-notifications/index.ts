import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type StatusRow = {
  member_id: string
  full_name: string
  email: string | null
  group_id: string
  group_name: string
  department_name: string
  course_id: string
  course_title: string
  category: string
  effective_valid_until: string | null
  notification_lead_days: number
  status: 'missing_gu' | 'expired' | 'due_soon' | 'valid'
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

function buildSubject(statusRow: StatusRow) {
  return `Kompetenspåminnelse: ${statusRow.course_title} för ${statusRow.full_name}`
}

function buildHtml(statusRow: StatusRow) {
  const dueText = statusRow.effective_valid_until ?? 'saknas'
  return `
    <h1>Kompetenspåminnelse</h1>
    <p><strong>${statusRow.full_name}</strong> i ${statusRow.department_name} / ${statusRow.group_name} behöver följas upp.</p>
    <p>Kurs: <strong>${statusRow.category} · ${statusRow.course_title}</strong></p>
    <p>Status: <strong>${statusRow.status === 'missing_gu' ? 'GU saknas' : statusRow.status === 'expired' ? 'Förfallen' : 'RU krävs snart'}</strong></p>
    <p>Giltig t.o.m.: <strong>${dueText}</strong></p>
  `.trim()
}

async function sendEmail(apiKey: string, fromEmail: string, toEmail: string, statusRow: StatusRow) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: buildSubject(statusRow),
      html: buildHtml(statusRow),
    }),
  })

  if (!response.ok) {
    throw new Error(`Resend svarade med ${response.status}`)
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('COMPETENCY_NOTIFICATION_FROM_EMAIL')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Funktionen saknar Supabase-konfiguration.')
    }

    if (!resendApiKey || !fromEmail) {
      throw new Error('Sätt RESEND_API_KEY och COMPETENCY_NOTIFICATION_FROM_EMAIL innan notifieringar körs.')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const today = new Date().toISOString().slice(0, 10)

    const { data: statusRows, error: statusError } = await supabase
      .from('competency_member_course_status')
      .select('member_id, full_name, email, group_id, group_name, department_name, course_id, course_title, category, effective_valid_until, notification_lead_days, status')
      .in('status', ['due_soon', 'expired', 'missing_gu'])

    if (statusError) {
      throw statusError
    }

    const rows = ((statusRows ?? []) as StatusRow[]).filter((row) => {
      if (row.status === 'missing_gu') {
        return true
      }

      if (!row.effective_valid_until) {
        return false
      }

      return row.effective_valid_until <= today || row.status === 'due_soon'
    })

    let sent = 0
    const failures: string[] = []

    for (const row of rows) {
      const { data: managers, error: managersError } = await supabase
        .from('competency_group_managers')
        .select('profiles:user_id(email)')
        .eq('group_id', row.group_id)

      if (managersError) {
        throw managersError
      }

      const recipients = new Set<string>()
      if (row.email) {
        recipients.add(row.email)
      }

      for (const manager of (managers ?? []) as Array<{ profiles: { email: string } | null }>) {
        if (manager.profiles?.email) {
          recipients.add(manager.profiles.email)
        }
      }

      for (const recipientEmail of recipients) {
        try {
          await sendEmail(resendApiKey, fromEmail, recipientEmail, row)
          sent += 1

          const { error: logError } = await supabase.from('competency_notification_log').insert({
            member_id: row.member_id,
            course_id: row.course_id,
            due_on: row.effective_valid_until,
            recipient_email: recipientEmail,
            delivery_status: 'sent',
          })

          if (logError) {
            throw logError
          }
        } catch (error) {
          failures.push(`${recipientEmail}: ${error instanceof Error ? error.message : 'Okänt fel'}`)

          await supabase.from('competency_notification_log').insert({
            member_id: row.member_id,
            course_id: row.course_id,
            due_on: row.effective_valid_until,
            recipient_email: recipientEmail,
            delivery_status: 'failed',
            delivery_error: error instanceof Error ? error.message : 'Okänt fel',
          })
        }
      }
    }

    return jsonResponse({ sent, failures })
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Okänt fel i notifieringsfunktionen.' },
      500,
    )
  }
})
