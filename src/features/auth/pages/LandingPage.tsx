import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

function hasSignupConfirmationParams(search: string, hash: string) {
  const searchParams = new URLSearchParams(search)
  if (searchParams.get('type') === 'signup') {
    return true
  }

  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash
  const hashParams = new URLSearchParams(normalizedHash)
  return hashParams.get('type') === 'signup'
}

export function LandingPage() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!hasSignupConfirmationParams(location.search, location.hash)) {
      return
    }

    navigate('/login', {
      replace: true,
      state: {
        emailVerified: true,
      },
    })
  }, [location.hash, location.search, navigate])

  return <Navigate to="/login" replace />
}
