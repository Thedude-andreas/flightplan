import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

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

  return (
    <div className="marketing-hero marketing-hero--start">
      <img className="marketing-hero__image" src="/Start-dialog.png" alt="" />
      <div className="marketing-hero__content">
        <h1>VFR FLIGHTPLAN</h1>
        <p className="marketing-hero__subtitle">VFRplan.se</p>
        <div className="marketing-hero__actions">
          <Link to="/login" className="button-link button-link--primary">
            Logga in
          </Link>
          <Link to="/signup" className="button-link">
            Skapa konto
          </Link>
        </div>
      </div>
    </div>
  )
}
