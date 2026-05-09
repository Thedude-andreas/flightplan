import type { DraftEnvelope } from '../../shared/types/persistence'

function isBrowser() {
  return typeof window !== 'undefined'
}

export function loadDraft<T>(key: string) {
  if (!isBrowser()) {
    return null
  }

  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as DraftEnvelope<T>
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

export function saveDraft<T>(key: string, draft: DraftEnvelope<T>) {
  if (!isBrowser()) {
    return
  }

  window.localStorage.setItem(key, JSON.stringify(draft))
}

export function clearDraft(key: string) {
  if (!isBrowser()) {
    return
  }

  window.localStorage.removeItem(key)
}
