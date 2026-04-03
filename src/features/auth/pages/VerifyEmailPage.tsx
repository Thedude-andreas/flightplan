import { useState } from 'react'
import { Link } from 'react-router-dom'
import { resendVerificationEmail } from '../api/authClient'
import { AuthFormShell } from '../components/AuthFormShell'
import { AuthNotice } from '../components/AuthNotice'
import { useAuth } from '../hooks/useAuth'

export function VerifyEmailPage() {
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
      await resendVerificationEmail(email)
      setSuccess('Verifieringsmail skickat igen.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Kunde inte skicka verifieringsmail.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell title="Verifiera email" description="Kontrollera inkorgen och öppna länken i verifieringsmailet.">
      <AuthNotice>Om länken redan öppnats kan du gå vidare till login. Annars kan du skicka mailet igen här.</AuthNotice>
      {error && <AuthNotice kind="error">{error}</AuthNotice>}
      {success && <AuthNotice kind="success">{success}</AuthNotice>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <button type="submit" disabled={!configured || submitting}>
          {submitting ? 'Skickar...' : 'Skicka verifieringsmail igen'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/login">Till login</Link>
      </div>
    </AuthFormShell>
  )
}
