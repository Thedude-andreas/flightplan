import { useState } from 'react'
import { Link } from 'react-router-dom'
import { updatePassword } from '../api/authClient'
import { AuthFormShell } from '../components/AuthFormShell'
import { AuthNotice } from '../components/AuthNotice'
import { useAuth } from '../hooks/useAuth'
import { getErrorMessage } from '../../../lib/supabase/errors'

export function ResetPasswordPage() {
  const { configured } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (password !== confirmPassword) {
      setError('Lösenorden matchar inte.')
      return
    }

    setSubmitting(true)

    try {
      await updatePassword(password)
      setSuccess('Lösenordet är uppdaterat. Du kan nu logga in.')
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte uppdatera lösenord.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell title="Nytt lösenord" description="Sätt ett nytt lösenord för ditt konto.">
      {error && <AuthNotice kind="error">{error}</AuthNotice>}
      {success && <AuthNotice kind="success">{success}</AuthNotice>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Nytt lösenord</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
        <label>
          <span>Bekräfta nytt lösenord</span>
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={!configured || submitting}>
          {submitting ? 'Uppdaterar...' : 'Uppdatera lösenord'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/login">Till login</Link>
      </div>
    </AuthFormShell>
  )
}
