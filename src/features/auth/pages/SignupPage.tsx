import { useState } from 'react'
import { Link } from 'react-router-dom'
import { signUpWithPassword } from '../api/authClient'
import { AuthFormShell } from '../components/AuthFormShell'
import { AuthNotice } from '../components/AuthNotice'
import { useAuth } from '../hooks/useAuth'

export function SignupPage() {
  const { configured } = useAuth()
  const [email, setEmail] = useState('')
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
      await signUpWithPassword(email, password)
      setSuccess('Verifieringsmail skickat. Kontrollera inkorgen innan du loggar in.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Kunde inte skapa konto.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthFormShell title="Skapa konto" description="Registrera dig med email och verifiera adressen innan första inloggningen.">
      {error && <AuthNotice kind="error">{error}</AuthNotice>}
      {success && <AuthNotice kind="success">{success}</AuthNotice>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          <span>Lösenord</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
        <label>
          <span>Bekräfta lösenord</span>
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
        </label>
        <button type="submit" disabled={!configured || submitting}>
          {submitting ? 'Skapar konto...' : 'Skapa konto'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/login">Har du redan konto?</Link>
      </div>
    </AuthFormShell>
  )
}
