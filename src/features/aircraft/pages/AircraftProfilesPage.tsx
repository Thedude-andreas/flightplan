import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createAircraftProfile, listAircraftProfiles } from '../api/aircraftProfilesRepository'
import type { AircraftProfileRecord } from '../types'
import { aircraftProfiles } from '../../flightplan/data'

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AircraftProfilesPage() {
  const [profiles, setProfiles] = useState<AircraftProfileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function loadProfiles() {
    setLoading(true)
    setError('')

    try {
      setProfiles(await listAircraftProfiles())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Kunde inte läsa flygplansprofiler.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  async function handleCreateTemplateProfile() {
    const template = aircraftProfiles[0]
    if (!template) {
      return
    }

    setCreating(true)
    setError('')

    try {
      const created = await createAircraftProfile({
        name: `${template.registration} mall`,
        registration: `${template.registration}-COPY`,
        typeName: template.typeName,
        payload: {
          ...template,
          registration: `${template.registration}-COPY`,
          typeName: `${template.typeName} kopia`,
        },
      })

      setProfiles((current) => [created, ...current])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Kunde inte skapa flygplansprofil.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="app-panel">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Flygplansprofiler</p>
          <h1>Mina flygplan</h1>
          <p>Första kopplingen till Supabase. Listan visar privata profiler för inloggad användare.</p>
        </div>
        <button type="button" onClick={handleCreateTemplateProfile} disabled={creating}>
          {creating ? 'Skapar...' : 'Skapa från mall'}
        </button>
      </div>

      {error && <p className="account-error">{error}</p>}

      {loading ? (
        <div className="app-card">Laddar flygplansprofiler...</div>
      ) : profiles.length === 0 ? (
        <div className="app-card">
          <h2>Inga sparade profiler</h2>
          <p>Börja med att skapa en profil från mallen. Nästa steg blir en riktig editorvy för profiler.</p>
        </div>
      ) : (
        <div className="resource-list">
          {profiles.map((profile) => (
            <article className="app-card" key={profile.id}>
              <div className="resource-list__header">
                <div>
                  <h2>{profile.name}</h2>
                  <p>{profile.registration} · {profile.typeName}</p>
                </div>
                <span className="resource-pill">{profile.visibility}</span>
              </div>
              <p>Senast uppdaterad {formatDateTime(profile.updatedAt)}</p>
              <div className="resource-list__actions">
                <Link to="/app/flightplans/new" className="button-link">
                  Använd i ny färdplan
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
