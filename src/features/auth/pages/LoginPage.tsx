import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signInWithPassword } from '../api/authClient'
import { AuthFormShell } from '../components/AuthFormShell'
import { AuthNotice } from '../components/AuthNotice'
import { useAuth } from '../hooks/useAuth'
import { getErrorMessage } from '../../../lib/supabase/errors'

type LocationState = {
  from?: string
  configurationRequired?: boolean
  emailVerified?: boolean
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const state = (location.state as LocationState | null) ?? null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await signInWithPassword(email, password)
      navigate(state?.from ?? '/app', { replace: true })
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte logga in.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell title="Logga in" description="Fortsätt till dina färdplaner och flygplansprofiler.">
      {state?.configurationRequired && (
        <AuthNotice kind="error">Supabase saknar miljövariabler. Sätt `VITE_SUPABASE_URL` och `VITE_SUPABASE_ANON_KEY` först.</AuthNotice>
      )}
      {state?.emailVerified && (
        <AuthNotice kind="success">Emailen är bekräftad. Du kan logga in nu.</AuthNotice>
      )}
      {error && <AuthNotice kind="error">{error}</AuthNotice>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          <span>Lösenord</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" disabled={!configured || submitting}>
          {submitting ? 'Loggar in...' : 'Logga in'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/forgot-password">Glömt lösenord?</Link>
        <Link to="/signup">Skapa konto</Link>
      </div>
    </AuthFormShell>
  )
}
