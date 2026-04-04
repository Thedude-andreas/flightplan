import { useState } from 'react'
import { signOut } from '../../auth/api/authClient'
import { useAuth } from '../../auth/hooks/useAuth'
import { getErrorMessage } from '../../../lib/supabase/errors'

export function AccountPage() {
  const { user } = useAuth()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSignOut() {
    setError('')
    setSubmitting(true)

    try {
      await signOut()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte logga ut.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="app-panel">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Konto</p>
          <h1>Inloggad användare</h1>
          <p>Det här är den första privata kontoytan. Profilhantering och preferenser kommer senare.</p>
        </div>
      </div>

      <article className="app-card">
        <dl className="account-list">
          <div>
            <dt>Email</dt>
            <dd>{user?.email ?? 'Ingen aktiv session'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{user?.emailVerified ? 'Verifierad' : 'Ej verifierad'}</dd>
          </div>
        </dl>

        {error && <p className="account-error">{error}</p>}

        <button type="button" onClick={handleSignOut} disabled={submitting}>
          {submitting ? 'Loggar ut...' : 'Logga ut'}
        </button>
      </article>
    </section>
  )
}
