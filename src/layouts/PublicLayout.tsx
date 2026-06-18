import type { CSSProperties } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppVersionBadge } from '../shared/components/AppVersionBadge'

const scenicAuthPaths = ['/', '/login', '/signup', '/verify-email', '/forgot-password', '/reset-password']
const loginBackgroundUrl = '/login-background_2.png'

export function PublicLayout() {
  const location = useLocation()
  const usesScreenshotBackground = scenicAuthPaths.includes(location.pathname)
  const style = usesScreenshotBackground
    ? ({ '--public-layout-login-background': `url(${loginBackgroundUrl})` } as CSSProperties)
    : undefined

  return (
    <div className={`public-layout${usesScreenshotBackground ? ' public-layout--login' : ''}`} style={style}>
      <div className="public-layout__backdrop" />
      <main className="public-layout__content">
        <Outlet />
      </main>
      <AppVersionBadge />
    </div>
  )
}
