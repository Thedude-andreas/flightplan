import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { deleteAircraftProfile, listAircraftProfiles } from '../api/aircraftProfilesRepository'
import type { AircraftProfileRecord } from '../types'
import './aircraft.css'

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AircraftProfilesPage() {
  const [profiles, setProfiles] = useState<AircraftProfileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadProfiles() {
    setLoading(true)
    setError('')

    try {
      setProfiles(await listAircraftProfiles())
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte läsa flygplansprofiler.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  async function handleDelete(id: string) {
    setError('')

    try {
      await deleteAircraftProfile(id)
      setProfiles((current) => current.filter((profile) => profile.id !== id))
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte ta bort flygplansprofilen.'))
    }
  }

  return (
    <section className="app-panel">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Flygplansprofiler</p>
          <h1>Mina flygplan</h1>
          <p>Bygg profiler från registerlookup, SkyDemon-import eller manuell inmatning.</p>
        </div>
        <Link to="/app/aircraft/new" className="button-link">Ny profil</Link>
      </div>

      {error && <p className="account-error">{error}</p>}

      {loading ? (
        <div className="app-card">Laddar flygplansprofiler...</div>
      ) : profiles.length === 0 ? (
        <div className="app-card">
          <h2>Inga sparade profiler</h2>
          <p>Skapa en tom profil eller importera en `.aircraft`-fil från SkyDemon.</p>
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
              <p>
                {profile.payload.identity?.manufacturer || 'Okänd tillverkare'}
                {profile.payload.identity?.model ? ` · ${profile.payload.identity.model}` : ''}
                {profile.payload.registrySnapshot?.registeredOwners[0] ? ` · ${profile.payload.registrySnapshot.registeredOwners[0]}` : ''}
              </p>
              <div className="resource-list__actions">
                <Link to={`/app/aircraft/${profile.id}`} className="button-link">Öppna</Link>
                <Link to="/app/flightplans/new" className="button-link">Använd i ny färdplan</Link>
                <button type="button" onClick={() => handleDelete(profile.id)}>Ta bort</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
