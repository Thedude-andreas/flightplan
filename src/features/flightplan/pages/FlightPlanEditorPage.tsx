import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FlightplanApp } from '../../../FlightplanApp'
import { useAuth } from '../../auth/hooks/useAuth'
import { useNetworkStatus } from '../../../lib/network/useNetworkStatus'
import { clearDraft, loadDraft, saveDraft } from '../../../lib/storage/draftStorage'
import type { DraftEnvelope, SaveState } from '../../../shared/types/persistence'
import { createFlightPlan, getFlightPlanById, updateFlightPlan } from '../api/flightPlansRepository'
import { createInitialFlightPlan } from '../data'
import type { FlightPlanInput } from '../types'

type FlightPlanDraftValue = {
  name: string
  plan: FlightPlanInput
}

function createDefaultPlanName() {
  const date = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(new Date())
  return `Ny färdplan ${date}`
}

function createDraftKey(userId: string, resourceId: string | null) {
  return `flightplan:draft:${userId}:${resourceId ?? 'new'}`
}

function createDraftEnvelope(
  name: string,
  plan: FlightPlanInput,
  resourceId: string | null,
  baseUpdatedAt: string | null,
  hasUnsavedChanges: boolean,
): DraftEnvelope<FlightPlanDraftValue> {
  return {
    resourceId,
    baseUpdatedAt,
    value: { name, plan },
    lastLocalSaveAt: new Date().toISOString(),
    hasUnsavedChanges,
  }
}

function getSaveLabel(state: SaveState) {
  switch (state) {
    case 'dirty':
      return 'Osparade ändringar'
    case 'saving':
      return 'Sparar...'
    case 'saved':
      return 'Sparad'
    case 'error':
      return 'Kunde inte spara'
    case 'conflict':
      return 'Konflikt upptäckt'
    default:
      return 'Ny färdplan'
  }
}

export function FlightPlanEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isOnline = useNetworkStatus()
  const didHydrateRef = useRef(false)
  const [initialPlan, setInitialPlan] = useState<FlightPlanInput | null>(null)
  const [currentPlan, setCurrentPlan] = useState<FlightPlanInput | null>(null)
  const [name, setName] = useState('')
  const [recordId, setRecordId] = useState<string | null>(null)
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const draftKey = useMemo(() => {
    if (!user) {
      return null
    }

    return createDraftKey(user.id, recordId ?? id ?? null)
  }, [id, recordId, user])

  useEffect(() => {
    let isActive = true

    async function loadState() {
      if (!user) {
        return
      }

      setLoading(true)
      setError('')
      didHydrateRef.current = false

      try {
        if (id) {
          const record = await getFlightPlanById(id)

          if (!isActive) {
            return
          }

          if (!record) {
            setError('Färdplanen kunde inte hittas.')
            const fallbackPlan = createInitialFlightPlan()
            setInitialPlan(fallbackPlan)
            setCurrentPlan(fallbackPlan)
            setName(createDefaultPlanName())
            setRecordId(null)
            setBaseUpdatedAt(null)
            setSaveState('error')
            return
          }

          const storedDraft = loadDraft<FlightPlanDraftValue>(createDraftKey(user.id, record.id))
          const matchingDraft = storedDraft?.baseUpdatedAt === record.updatedAt ? storedDraft : null

          const nextPlan = matchingDraft?.value.plan ?? record.payload
          setInitialPlan(nextPlan)
          setCurrentPlan(nextPlan)
          setName(matchingDraft?.value.name ?? record.name)
          setRecordId(record.id)
          setBaseUpdatedAt(record.updatedAt)
          setSaveState(matchingDraft?.hasUnsavedChanges ? 'dirty' : 'saved')
        } else {
          const storedDraft = loadDraft<FlightPlanDraftValue>(createDraftKey(user.id, null))

          const nextPlan = storedDraft?.value.plan ?? createInitialFlightPlan()
          setInitialPlan(nextPlan)
          setCurrentPlan(nextPlan)
          setName(storedDraft?.value.name ?? createDefaultPlanName())
          setRecordId(null)
          setBaseUpdatedAt(storedDraft?.baseUpdatedAt ?? null)
          setSaveState(storedDraft?.hasUnsavedChanges ? 'dirty' : 'idle')
        }
      } catch (nextError) {
        if (!isActive) {
          return
        }

        setError(nextError instanceof Error ? nextError.message : 'Kunde inte ladda färdplanen.')
        setSaveState('error')
      } finally {
        if (isActive) {
          setLoading(false)
          window.setTimeout(() => {
            didHydrateRef.current = true
          }, 0)
        }
      }
    }

    void loadState()

    return () => {
      isActive = false
    }
  }, [id, user])

  useEffect(() => {
    if (!draftKey || !currentPlan || !didHydrateRef.current) {
      return
    }

    const hasUnsavedChanges = saveState === 'dirty' || saveState === 'error' || saveState === 'conflict'
    saveDraft(draftKey, createDraftEnvelope(name, currentPlan, recordId, baseUpdatedAt, hasUnsavedChanges))
  }, [baseUpdatedAt, currentPlan, draftKey, name, recordId, saveState])

  async function handleSave() {
    if (!currentPlan || !name.trim()) {
      setError('Ange ett namn innan du sparar färdplanen.')
      setSaveState('error')
      return
    }

    setSaveState('saving')
    setError('')

    try {
      if (recordId) {
        const updated = await updateFlightPlan(
          recordId,
          {
            name: name.trim(),
            payload: currentPlan,
          },
          baseUpdatedAt ?? '',
        )

        setBaseUpdatedAt(updated.updatedAt)
        setSaveState('saved')
        if (draftKey) {
          clearDraft(draftKey)
        }
        return
      }

      const created = await createFlightPlan({
        name: name.trim(),
        payload: currentPlan,
      })

      if (draftKey) {
        clearDraft(draftKey)
      }

      setRecordId(created.id)
      setBaseUpdatedAt(created.updatedAt)
      setSaveState('saved')
      navigate(`/app/flightplans/${created.id}`, { replace: true })
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Kunde inte spara färdplanen.'
      setError(message)
      setSaveState(message.toLowerCase().includes('konflikt') ? 'conflict' : 'error')
    }
  }

  if (loading || !initialPlan) {
    return (
      <section className="app-panel">
        <div className="app-card">Laddar editor...</div>
      </section>
    )
  }

  return (
    <section className="editor-page">
      <div className="editor-toolbar">
        <div className="editor-toolbar__main">
          <div>
            <p className="app-eyebrow">Färdplanseditor</p>
            <input
              className="editor-toolbar__title"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setSaveState('dirty')
              }}
              placeholder="Namnge färdplanen"
            />
          </div>
          <div className="editor-toolbar__meta">
            <span className={`resource-pill resource-pill--${saveState}`}>{getSaveLabel(saveState)}</span>
            <span className={`resource-pill ${isOnline ? '' : 'resource-pill--warning'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="editor-toolbar__actions">
          <Link to="/app/flightplans" className="button-link">
            Till listan
          </Link>
          <button type="button" onClick={handleSave} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </div>

      {error && <p className="account-error editor-toolbar__error">{error}</p>}

      <FlightplanApp
        key={`${recordId ?? 'new'}:${baseUpdatedAt ?? 'draft'}`}
        initialPlan={initialPlan}
        headerSlot={
          <span className={`resource-pill resource-pill--inline ${saveState === 'dirty' ? 'resource-pill--warning' : ''}`}>
            {getSaveLabel(saveState)}
          </span>
        }
        onPlanChange={(nextPlan) => {
          if (!didHydrateRef.current) {
            return
          }

          setCurrentPlan(nextPlan)
          setSaveState((current) => (current === 'saving' ? current : 'dirty'))
        }}
      />
    </section>
  )
}
