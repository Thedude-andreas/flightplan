import type { AircraftProfile } from '../flightplan/types'
import type { Visibility } from '../../shared/types/persistence'

export type AircraftProfileRecord = {
  id: string
  ownerUserId: string
  name: string
  registration: string
  typeName: string
  visibility: Visibility
  payload: AircraftProfile
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type CreateAircraftProfileInput = {
  name: string
  registration: string
  typeName: string
  visibility?: Visibility
  payload: AircraftProfile
}

export type UpdateAircraftProfileInput = CreateAircraftProfileInput
