import { getSupabaseClient } from '../../../lib/supabase/client'
import type { CreateFlightPlanInput, FlightPlanRecord, UpdateFlightPlanInput } from '../persistenceTypes'

type FlightPlanRow = {
  id: string
  owner_user_id: string
  name: string
  aircraft_profile_id: string | null
  status: FlightPlanRecord['status']
  visibility: FlightPlanRecord['visibility']
  payload: FlightPlanRecord['payload']
  created_at: string
  updated_at: string
  archived_at: string | null
}

function requireClient() {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('Supabase är inte konfigurerat.')
  }

  return client
}

function mapRecord(row: FlightPlanRow): FlightPlanRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    aircraftProfileId: row.aircraft_profile_id,
    status: row.status,
    visibility: row.visibility,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

export async function listFlightPlans() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('flight_plans')
    .select('id, owner_user_id, name, aircraft_profile_id, status, visibility, payload, created_at, updated_at, archived_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }

  return ((data ?? []) as FlightPlanRow[]).map(mapRecord)
}

export async function getFlightPlanById(id: string) {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('flight_plans')
    .select('id, owner_user_id, name, aircraft_profile_id, status, visibility, payload, created_at, updated_at, archived_at')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data ? mapRecord(data as FlightPlanRow) : null
}

export async function createFlightPlan(input: CreateFlightPlanInput) {
  const supabase = requireClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    throw new Error('Ingen aktiv användare.')
  }

  const { data, error } = await supabase
    .from('flight_plans')
    .insert({
      owner_user_id: user.id,
      name: input.name,
      aircraft_profile_id: input.aircraftProfileId ?? null,
      status: input.status ?? 'draft',
      visibility: input.visibility ?? 'private',
      payload: input.payload,
    })
    .select('id, owner_user_id, name, aircraft_profile_id, status, visibility, payload, created_at, updated_at, archived_at')
    .single()

  if (error) {
    throw error
  }

  return mapRecord(data as FlightPlanRow)
}

export async function archiveFlightPlan(id: string) {
  const supabase = requireClient()
  const { error } = await supabase.from('flight_plans').update({ archived_at: new Date().toISOString() }).eq('id', id)

  if (error) {
    throw error
  }
}

export async function updateFlightPlan(id: string, input: UpdateFlightPlanInput, expectedUpdatedAt: string) {
  const supabase = requireClient()

  const { data: current, error: loadError } = await supabase
    .from('flight_plans')
    .select('updated_at')
    .eq('id', id)
    .single()

  if (loadError) {
    throw loadError
  }

  if (current.updated_at !== expectedUpdatedAt) {
    throw new Error('Konflikt upptäckt. Färdplanen har uppdaterats i en annan session.')
  }

  const { data, error } = await supabase
    .from('flight_plans')
    .update({
      name: input.name,
      aircraft_profile_id: input.aircraftProfileId ?? null,
      status: input.status ?? 'draft',
      visibility: input.visibility ?? 'private',
      payload: input.payload,
    })
    .eq('id', id)
    .select('id, owner_user_id, name, aircraft_profile_id, status, visibility, payload, created_at, updated_at, archived_at')
    .single()

  if (error) {
    throw error
  }

  return mapRecord(data as FlightPlanRow)
}
