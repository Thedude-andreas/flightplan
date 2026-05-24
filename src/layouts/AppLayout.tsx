import { Link, Outlet, useLocation } from 'react-router-dom'
import { AppVersionBadge } from '../shared/components/AppVersionBadge'
import { BetaDisclaimerDialog } from '../shared/components/BetaDisclaimerDialog'

export function AppLayout() {
  const location = useLocation()
  const isFlightPlanEditor = /^\/app\/flightplans(?:\/new|\/[^/]+)$/.test(location.pathname)
  const isMapWorkspace = location.pathname === '/app' || isFlightPlanEditor

  return (
    <div className={`app-layout app-layout--editor ${isMapWorkspace ? '' : 'app-layout--map-panel'}`}>
      <main className="app-layout__content">
        {!isMapWorkspace ? (
          <Link to="/app" className="app-map-panel-close" aria-label="Stäng och återgå till kartan">
            ×
          </Link>
        ) : null}
        <Outlet />
      </main>
      <AppVersionBadge />
      <BetaDisclaimerDialog />
    </div>
  )
}
