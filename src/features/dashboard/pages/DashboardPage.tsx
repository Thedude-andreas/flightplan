import { Link } from 'react-router-dom'

export function DashboardPage() {
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
      </div>
    </section>
  )
}
