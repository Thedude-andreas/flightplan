import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthFormShell } from '../components/AuthFormShell'
import { AuthNotice } from '../components/AuthNotice'

export function VerifyEmailPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/login', {
      replace: true,
      state: {
        emailVerified: true,
      },
    })
  }, [navigate])

  return (
    <AuthFormShell title="Verifierar email" description="Bekräftelsen behandlas och du skickas vidare till login.">
      <AuthNotice>Omdirigerar till login...</AuthNotice>
    </AuthFormShell>
  )
}
