import type { Visibility, ResourceStatus } from '../../shared/types/persistence'
import type { FlightPlanInput } from './types'

export type FlightPlanRecord = {
  id: string
  ownerUserId: string
  name: string
  aircraftProfileId: string | null
  status: ResourceStatus
  visibility: Visibility
  payload: FlightPlanInput
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type CreateFlightPlanInput = {
  name: string
  aircraftProfileId?: string | null
  status?: ResourceStatus
  visibility?: Visibility
  payload: FlightPlanInput
}

export type UpdateFlightPlanInput = CreateFlightPlanInput
