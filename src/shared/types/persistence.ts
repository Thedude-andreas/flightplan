export type Visibility = 'private' | 'shared' | 'public'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export type ResourceStatus = 'draft' | 'active' | 'archived'

export type DraftEnvelope<T> = {
  resourceId: string | null
  baseUpdatedAt: string | null
  value: T
  lastLocalSaveAt: string
  hasUnsavedChanges: boolean
}
