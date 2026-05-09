import { useState } from 'react'
import { Link } from 'react-router-dom'
import { requestPasswordReset } from '../api/authClient'
import { AuthFormShell } from '../components/AuthFormShell'
import { AuthNotice } from '../components/AuthNotice'
import { useAuth } from '../hooks/useAuth'
import { getErrorMessage } from '../../../lib/supabase/errors'

export function ForgotPasswordPage() {
  const { configured } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      await requestPasswordReset(email)
      setSuccess('Om adressen finns i systemet har ett återställningsmail skickats.')
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte skicka återställningsmail.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell title="Glömt lösenord" description="Ange din email så skickar vi en återställningslänk.">
      {error && <AuthNotice kind="error">{error}</AuthNotice>}
      {success && <AuthNotice kind="success">{success}</AuthNotice>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <button type="submit" disabled={!configured || submitting}>
          {submitting ? 'Skickar...' : 'Skicka återställningslänk'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/login">Tillbaka till login</Link>
      </div>
    </AuthFormShell>
  )
}
