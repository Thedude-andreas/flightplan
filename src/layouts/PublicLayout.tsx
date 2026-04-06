import { Outlet, useLocation } from 'react-router-dom'

export function PublicLayout() {
  const location = useLocation()
  const usesScreenshotBackground = location.pathname === '/' || location.pathname === '/login'

  return (
    <div className={`public-layout${usesScreenshotBackground ? ' public-layout--login' : ''}`}>
      <div className="public-layout__backdrop" />
      <main className="public-layout__content">
        <Outlet />
      </main>
    </div>
  )
}
