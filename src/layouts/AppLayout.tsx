import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/hooks/useAuth'
import { AppVersionBadge } from '../shared/components/AppVersionBadge'

export function AppLayout() {
  const { user } = useAuth()
  const location = useLocation()
  const isFlightPlanEditor = /^\/app\/flightplans(?:\/new|\/[^/]+)$/.test(location.pathname)

  return (
    <div className={`app-layout ${isFlightPlanEditor ? 'app-layout--editor' : ''}`}>
      {!isFlightPlanEditor && (
        <aside className="app-sidebar">
          <div className="app-sidebar__brand">
            <p className="app-eyebrow">VFRplan.se</p>
            <strong>Privat arbetsyta</strong>
            <span>{user?.email}</span>
          </div>

          <nav className="app-nav">
            <NavLink to="/app" end>
              Dashboard
            </NavLink>
            <NavLink to="/app/flightplans">Färdplaner</NavLink>
            <NavLink to="/app/aircraft">Flygplan</NavLink>
            <NavLink to="/app/account">Konto</NavLink>
          </nav>
        </aside>
      )}

      <main className="app-layout__content">
        <Outlet />
      </main>
      <AppVersionBadge />
    </div>
  )
}
