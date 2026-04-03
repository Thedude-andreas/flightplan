import { Outlet } from 'react-router-dom'

export function PublicLayout() {
  return (
    <div className="public-layout">
      <div className="public-layout__backdrop" />
      <main className="public-layout__content">
        <Outlet />
      </main>
    </div>
  )
}
