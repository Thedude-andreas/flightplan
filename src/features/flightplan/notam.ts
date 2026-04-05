import { getSupabaseClient } from '../../lib/supabase/client'

export type AirportNotam = {
  icao: string
  airportName: string | null
  rawText: string | null
  hasNotams: boolean
}

export type NotamSupplement = {
  id: string
  title: string
  source: 'eaip-cover' | 'trigger-notam'
  url: string | null
}

export type NotamResponse = {
  sourceUrl: string | null
  fetchedAt: string | null
  bulletinPublishedAt: string | null
  enRouteText: string | null
  warningsText: string | null
  supplementSourceUrl: string | null
  supplements: NotamSupplement[]
  notams: AirportNotam[]
}

export async function fetchNotamsForAirports(icaos: string[]) {
  const supabase = getSupabaseClient()

  if (!supabase) {
    throw new Error('Supabase är inte konfigurerat. NOTAM-proxy kräver backend-stöd.')
  }

  const { data, error } = await supabase.functions.invoke('notam-briefing', {
    body: { icaos },
  })

  if (error) {
    throw new Error(error.message)
  }

  return data as NotamResponse
}
