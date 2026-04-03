import { getSupabaseClient } from '../../../lib/supabase/client'
import type { CreateAircraftProfileInput, AircraftProfileRecord, UpdateAircraftProfileInput } from '../types'

type AircraftProfileRow = {
  id: string
  owner_user_id: string
  name: string
  registration: string
  type_name: string
  visibility: AircraftProfileRecord['visibility']
  payload: AircraftProfileRecord['payload']
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

function mapRecord(row: AircraftProfileRow): AircraftProfileRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    registration: row.registration,
    typeName: row.type_name,
    visibility: row.visibility,
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

export async function listAircraftProfiles() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('aircraft_profiles')
    .select('id, owner_user_id, name, registration, type_name, visibility, payload, created_at, updated_at, archived_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }

  return ((data ?? []) as AircraftProfileRow[]).map(mapRecord)
}

export async function createAircraftProfile(input: CreateAircraftProfileInput) {
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
    .from('aircraft_profiles')
    .insert({
      owner_user_id: user.id,
      name: input.name,
      registration: input.registration,
      type_name: input.typeName,
      visibility: input.visibility ?? 'private',
      payload: input.payload,
    })
    .select('id, owner_user_id, name, registration, type_name, visibility, payload, created_at, updated_at, archived_at')
    .single()

  if (error) {
    throw error
  }

  return mapRecord(data as AircraftProfileRow)
}

export async function archiveAircraftProfile(id: string) {
  const supabase = requireClient()
  const { error } = await supabase.from('aircraft_profiles').update({ archived_at: new Date().toISOString() }).eq('id', id)

  if (error) {
    throw error
  }
}

export async function updateAircraftProfile(id: string, input: UpdateAircraftProfileInput, expectedUpdatedAt: string) {
  const supabase = requireClient()

  const { data: current, error: loadError } = await supabase
    .from('aircraft_profiles')
    .select('updated_at')
    .eq('id', id)
    .single()

  if (loadError) {
    throw loadError
  }

  if (current.updated_at !== expectedUpdatedAt) {
    throw new Error('Konflikt upptäckt. Profilen har uppdaterats i en annan session.')
  }

  const { data, error } = await supabase
    .from('aircraft_profiles')
    .update({
      name: input.name,
      registration: input.registration,
      type_name: input.typeName,
      visibility: input.visibility ?? 'private',
      payload: input.payload,
    })
    .eq('id', id)
    .select('id, owner_user_id, name, registration, type_name, visibility, payload, created_at, updated_at, archived_at')
    .single()

  if (error) {
    throw error
  }

  return mapRecord(data as AircraftProfileRow)
}
