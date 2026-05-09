import { getSupabaseClient } from '../../../lib/supabase/client'
import type { AircraftRegistrySnapshot } from '../profileTypes'

export async function lookupAircraftRegistry(registration: string) {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('Supabase är inte konfigurerat.')
  }

  const { data, error } = await client.functions.invoke<AircraftRegistrySnapshot>('aircraft-registry-lookup', {
    body: { registration },
  })

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Tomt svar från registeruppslag.')
  }

  return data
}
