import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute() {
  const { configured, status } = useAuth()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}${location.hash}`

  if (!configured) {
    return <Navigate to="/login" replace state={{ from: returnTo, configurationRequired: true }} />
  }

  if (status === 'loading') {
    return <div className="auth-status-card">Kontrollerar session...</div>
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: returnTo }} />
  }

  return <Outlet />
}
