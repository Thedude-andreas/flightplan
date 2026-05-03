import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/hooks/useAuth'
import { getCurrentCompetencyPermission } from '../features/competency/api/competencyRepository'
import { AppVersionBadge } from '../shared/components/AppVersionBadge'

export function AppLayout() {
  const { user } = useAuth()
  const location = useLocation()
  const isMapWorkspace = location.pathname === '/app'
  const isFlightPlanEditor = /^\/app\/flightplans(?:\/new|\/[^/]+)$/.test(location.pathname)
  const isImmersiveWorkspace = isMapWorkspace || isFlightPlanEditor
  const [canAccessCompetency, setCanAccessCompetency] = useState(false)

  useEffect(() => {
    let isMounted = true

    void getCurrentCompetencyPermission()
      .then((permission) => {
        if (isMounted) {
          setCanAccessCompetency(Boolean(permission?.moduleAccess))
        }
      })
      .catch(() => {
        if (isMounted) {
          setCanAccessCompetency(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  return (
    <div className={`app-layout ${isImmersiveWorkspace ? 'app-layout--editor' : ''}`}>
      {!isImmersiveWorkspace && (
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
            {canAccessCompetency ? <NavLink to="/app/competency">Kompetens</NavLink> : null}
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
