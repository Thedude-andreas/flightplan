import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCurrentCompetencyPermission } from '../../competency/api/competencyRepository'

export function DashboardPage() {
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
    <section className="app-panel">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Dashboard</p>
          <h1>Arbetsyta</h1>
          <p>Auth och routing är nu på plats. Nästa steg är att koppla riktig persistens för färdplaner och flygplansprofiler.</p>
        </div>
      </div>

      <div className="app-grid">
        <article className="app-card">
          <h2>Färdplaner</h2>
          <p>Listvy och första datalager mot Supabase finns nu på plats.</p>
          <Link to="/app/flightplans" className="button-link button-link--primary">
            Visa färdplaner
          </Link>
        </article>

        <article className="app-card">
          <h2>Flygplansprofiler</h2>
          <p>Privata profiler kan nu läsas från databasen och skapas från mall.</p>
          <Link to="/app/aircraft" className="button-link">
            Visa profiler
          </Link>
        </article>

        {canAccessCompetency ? (
          <article className="app-card">
            <h2>Kompetens</h2>
            <p>Följ upp GU/RU per kurs, hantera gruppmedlemmar och bygg sammanställningar över kommande utbildningsbehov.</p>
            <Link to="/app/competency" className="button-link">
              Visa kompetensmodul
            </Link>
          </article>
        ) : null}
      </div>
    </section>
  )
}
