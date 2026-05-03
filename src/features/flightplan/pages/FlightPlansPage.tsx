import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { createFlightPlan, deleteFlightPlan, listFlightPlans, updateFlightPlan } from '../api/flightPlansRepository'
import type { FlightPlanRecord } from '../persistenceTypes'

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function createCopyName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Ny färdplan kopia'
  }

  return trimmed.toLowerCase().includes('kopia') ? trimmed : `${trimmed} kopia`
}

export function FlightPlansPage() {
  const [plans, setPlans] = useState<FlightPlanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copySource, setCopySource] = useState<FlightPlanRecord | null>(null)
  const [copyName, setCopyName] = useState('')
  const [renameSource, setRenameSource] = useState<FlightPlanRecord | null>(null)
  const [renameName, setRenameName] = useState('')

  async function loadPlans() {
    setLoading(true)
    setError('')

    try {
      setPlans(await listFlightPlans())
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte läsa färdplaner.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPlans()
  }, [])

  function openSaveCopyDialog(plan: FlightPlanRecord) {
    setCopySource(plan)
    setCopyName(createCopyName(plan.name))
  }

  function openRenameDialog(plan: FlightPlanRecord) {
    setRenameSource(plan)
    setRenameName(plan.name)
  }

  async function handleSaveCopy() {
    if (!copySource || !copyName.trim()) {
      setError('Ange ett namn innan du sparar kopian.')
      return
    }

    setError('')

    try {
      const created = await createFlightPlan({
        name: copyName.trim(),
        aircraftProfileId: copySource.aircraftProfileId,
        status: copySource.status,
        visibility: copySource.visibility,
        payload: copySource.payload,
      })

      setPlans((current) => [created, ...current])
      setCopySource(null)
      setCopyName('')
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara kopian av färdplanen.'))
    }
  }

  async function handleDelete(id: string) {
    setError('')

    try {
      await deleteFlightPlan(id)
      setPlans((current) => current.filter((plan) => plan.id !== id))
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte ta bort färdplanen.'))
    }
  }

  async function handleRename() {
    if (!renameSource || !renameName.trim()) {
      setError('Ange ett namn innan du byter namn på färdplanen.')
      return
    }

    setError('')

    try {
      const updated = await updateFlightPlan(
        renameSource.id,
        {
          name: renameName.trim(),
          aircraftProfileId: renameSource.aircraftProfileId,
          status: renameSource.status,
          visibility: renameSource.visibility,
          payload: renameSource.payload,
        },
        renameSource.updatedAt,
      )

      setPlans((current) =>
        current.map((plan) => (plan.id === updated.id ? updated : plan)),
      )
      setRenameSource(null)
      setRenameName('')
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte byta namn på färdplanen.'))
    }
  }

  return (
    <section className="app-panel">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Färdplaner</p>
          <h1>Mina färdplaner</h1>
        </div>
        <div className="resource-list__actions">
          <Link to="/app/flightplans/new" className="button-link button-link--primary">
            Skapa ny
          </Link>
        </div>
      </div>

      {error && <p className="account-error">{error}</p>}

      {loading ? (
        <div className="app-card">Laddar färdplaner...</div>
      ) : plans.length === 0 ? (
        <div className="app-card">
          <h2>Inga sparade färdplaner</h2>
          <p>Skapa din första färdplan för att komma igång.</p>
        </div>
      ) : (
        <div className="resource-list">
          {plans.map((plan) => (
            <article className="app-card" key={plan.id}>
              <div className="resource-list__header">
                <div>
                  <h2>{plan.name}</h2>
                  <p>
                    {plan.payload.header.departureAerodrome} → {plan.payload.header.destinationAerodrome}
                  </p>
                </div>
                <span className="resource-pill">{plan.status}</span>
              </div>
              <p>Senast uppdaterad {formatDateTime(plan.updatedAt)}</p>
              <div className="resource-list__actions">
                <Link to={`/app/flightplans/${plan.id}`} className="button-link">
                  Öppna
                </Link>
                <button type="button" onClick={() => openRenameDialog(plan)}>
                  Byt namn
                </button>
                <button type="button" onClick={() => openSaveCopyDialog(plan)}>
                  Spara kopia
                </button>
                <button type="button" onClick={() => handleDelete(plan.id)}>
                  Ta bort
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {copySource && (
        <div className="dialog-backdrop" onClick={() => setCopySource(null)}>
          <section className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h2>Spara kopia</h2>
            <p>Ange namnet på den nya färdplanen innan kopian sparas.</p>
            <label className="dialog-field">
              <span>Namn</span>
              <input value={copyName} onChange={(event) => setCopyName(event.target.value)} autoFocus />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button-link" onClick={() => setCopySource(null)}>
                Avbryt
              </button>
              <button type="button" onClick={handleSaveCopy}>
                Spara kopia
              </button>
            </div>
          </section>
        </div>
      )}

      {renameSource && (
        <div className="dialog-backdrop" onClick={() => setRenameSource(null)}>
          <section className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h2>Byt namn</h2>
            <p>Uppdatera namnet på färdplanen.</p>
            <label className="dialog-field">
              <span>Namn</span>
              <input value={renameName} onChange={(event) => setRenameName(event.target.value)} autoFocus />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button-link" onClick={() => setRenameSource(null)}>
                Avbryt
              </button>
              <button type="button" onClick={handleRename}>
                Spara namn
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
