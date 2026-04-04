type ErrorWithMessage = {
  message?: unknown
  details?: unknown
  hint?: unknown
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const candidate = error as ErrorWithMessage
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message
    }

    if (typeof candidate.details === 'string' && candidate.details.trim()) {
      return candidate.details
    }

    if (typeof candidate.hint === 'string' && candidate.hint.trim()) {
      return candidate.hint
    }
  }

  return fallback
}
