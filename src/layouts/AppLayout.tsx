import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../features/auth/hooks/useAuth'

export function AppLayout() {
  const { user } = useAuth()

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <p className="app-eyebrow">Flightplan</p>
          <strong>Privat arbetsyta</strong>
          <span>{user?.email}</span>
        </div>

        <nav className="app-nav">
          <NavLink to="/app" end>
            Dashboard
          </NavLink>
          <NavLink to="/app/flightplans">Färdplaner</NavLink>
          <NavLink to="/app/flightplans/new">Ny färdplan</NavLink>
          <NavLink to="/app/aircraft">Flygplan</NavLink>
          <NavLink to="/app/account">Konto</NavLink>
        </nav>
      </aside>

      <main className="app-layout__content">
        <Outlet />
      </main>
    </div>
  )
}
