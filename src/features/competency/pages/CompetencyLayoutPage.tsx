import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { useAuth } from '../../auth/hooks/useAuth'
import { loadCompetencyWorkspace } from '../api/competencyRepository'
import type { CompetencyPermission } from '../types'
import './competency.css'

export function CompetencyLayoutPage() {
  const { user } = useAuth()
  const [permission, setPermission] = useState<CompetencyPermission | null>(null)
  const [departmentLeaderCount, setDepartmentLeaderCount] = useState(0)
  const [managerGroupCount, setManagerGroupCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      setLoading(true)
      setError('')

      try {
        const workspace = await loadCompetencyWorkspace()
        if (!isMounted) {
          return
        }

        setPermission(workspace.permission)
        setDepartmentLeaderCount(
          workspace.departments.filter((department) =>
            department.leaders.some((leader) => leader.userId === user?.id),
          ).length,
        )
        setManagerGroupCount(
          workspace.groups.filter((group) =>
            group.managers.some((manager) => manager.userId === user?.id),
          ).length,
        )
      } catch (nextError) {
        if (isMounted) {
          setError(getErrorMessage(nextError, 'Kunde inte läsa kompetensmodulen.'))
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [user?.id])

  const access = useMemo(() => ({
    admin: Boolean(permission?.managePermissions || permission?.manageCatalog),
    manager: Boolean(permission?.managePermissions || permission?.manageCatalog || managerGroupCount > 0),
    needs: Boolean(permission?.managePermissions || permission?.manageCatalog || permission?.viewReports || departmentLeaderCount > 0 || managerGroupCount > 0),
  }), [departmentLeaderCount, managerGroupCount, permission])

  if (loading) {
    return <section className="app-panel"><div className="app-card">Laddar kompetensmodul...</div></section>
  }

  if (!permission?.moduleAccess) {
    return (
      <section className="app-panel">
        <div className="app-panel__header">
          <div>
            <p className="app-eyebrow">Kompetens</p>
            <h1>Behörighet krävs</h1>
            <p>Den här modulen är låst. En administratör behöver ge ditt konto modulåtkomst.</p>
          </div>
        </div>
        {error ? <p className="account-error">{error}</p> : null}
      </section>
    )
  }

  return (
    <section className="app-panel competency-page">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Kompetens</p>
          <h1>Besättningars utbildningar</h1>
          <p>Admin hanterar organisation och behörigheter, gruppchefer registrerar besättning och kurser, och behovssidan visar rätt scope för admin, länsledning och gruppchefer.</p>
        </div>
      </div>

      {error ? <p className="account-error">{error}</p> : null}

      <nav className="competency-tabs">
        {access.admin ? <NavLink to="/app/competency/admin">Admin</NavLink> : null}
        {access.manager ? <NavLink to="/app/competency/manager">Gruppchef</NavLink> : null}
        {access.needs ? <NavLink to="/app/competency/needs">Utbildningsbehov</NavLink> : null}
      </nav>

      <Outlet />
    </section>
  )
}
