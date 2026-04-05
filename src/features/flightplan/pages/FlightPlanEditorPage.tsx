import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FlightplanApp } from '../../../FlightplanApp'
import { useAuth } from '../../auth/hooks/useAuth'
import { useNetworkStatus } from '../../../lib/network/useNetworkStatus'
import { clearDraft, loadDraft, saveDraft } from '../../../lib/storage/draftStorage'
import { getErrorMessage } from '../../../lib/supabase/errors'
import type { DraftEnvelope, SaveState } from '../../../shared/types/persistence'
import { createFlightPlan, getFlightPlanById, updateFlightPlan } from '../api/flightPlansRepository'
import { createEmptyFlightPlan, createInitialFlightPlan } from '../data'
import type { FlightPlanInput } from '../types'

type FlightPlanDraftValue = {
  name: string
  plan: FlightPlanInput
}

type PersistedSnapshot = {
  name: string
  plan: FlightPlanInput
}

function createDefaultPlanName() {
  const date = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(new Date())
  return `Ny färdplan ${date}`
}

function createCopyName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Ny färdplan kopia'
  }

  return trimmed.toLowerCase().includes('kopia') ? trimmed : `${trimmed} kopia`
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

function serializePlan(plan: FlightPlanInput | null) {
  return plan ? JSON.stringify(plan) : ''
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
  const [persistedSnapshot, setPersistedSnapshot] = useState<PersistedSnapshot | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copyName, setCopyName] = useState('')
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)
  const [isClearRouteDialogOpen, setIsClearRouteDialogOpen] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)

  const draftKey = useMemo(() => {
    if (!user) {
      return null
    }

    return createDraftKey(user.id, recordId ?? id ?? null)
  }, [id, recordId, user])

  const currentPlanSignature = useMemo(() => serializePlan(currentPlan), [currentPlan])
  const persistedPlanSignature = useMemo(() => serializePlan(persistedSnapshot?.plan ?? null), [persistedSnapshot])
  const hasUnsavedChanges = currentPlan && persistedSnapshot
    ? name.trim() !== persistedSnapshot.name.trim() || currentPlanSignature !== persistedPlanSignature
    : false

  const displaySaveState: SaveState =
    saveState === 'saving' || saveState === 'error' || saveState === 'conflict'
      ? saveState
      : hasUnsavedChanges
        ? 'dirty'
        : recordId
          ? 'saved'
          : 'idle'

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
            setPersistedSnapshot({
              name: createDefaultPlanName(),
              plan: fallbackPlan,
            })
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
          setPersistedSnapshot({
            name: record.name,
            plan: record.payload,
          })
          setSaveState(matchingDraft?.hasUnsavedChanges ? 'dirty' : 'saved')
        } else {
          const storedDraft = loadDraft<FlightPlanDraftValue>(createDraftKey(user.id, null))

          const nextPlan = storedDraft?.value.plan ?? createEmptyFlightPlan()
          const nextName = storedDraft?.value.name ?? createDefaultPlanName()
          setInitialPlan(nextPlan)
          setCurrentPlan(nextPlan)
          setName(nextName)
          setRecordId(null)
          setBaseUpdatedAt(storedDraft?.baseUpdatedAt ?? null)
          setPersistedSnapshot({
            name: nextName,
            plan: nextPlan,
          })
          setSaveState(storedDraft?.hasUnsavedChanges ? 'dirty' : 'idle')
        }
      } catch (nextError) {
        if (!isActive) {
          return
        }

        setError(getErrorMessage(nextError, 'Kunde inte ladda färdplanen.'))
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

    const shouldPersistDraft = hasUnsavedChanges || saveState === 'error' || saveState === 'conflict'
    saveDraft(draftKey, createDraftEnvelope(name, currentPlan, recordId, baseUpdatedAt, shouldPersistDraft))
  }, [baseUpdatedAt, currentPlan, draftKey, hasUnsavedChanges, name, recordId, saveState])

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

        setInitialPlan(updated.payload)
        setCurrentPlan(updated.payload)
        setName(updated.name)
        setBaseUpdatedAt(updated.updatedAt)
        setPersistedSnapshot({
          name: updated.name,
          plan: updated.payload,
        })
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

      setInitialPlan(created.payload)
      setCurrentPlan(created.payload)
      setName(created.name)
      setRecordId(created.id)
      setBaseUpdatedAt(created.updatedAt)
      setPersistedSnapshot({
        name: created.name,
        plan: created.payload,
      })
      setSaveState('saved')
      navigate(`/app/flightplans/${created.id}`, { replace: true })
    } catch (nextError) {
      const message = getErrorMessage(nextError, 'Kunde inte spara färdplanen.')
      setError(message)
      setSaveState(message.toLowerCase().includes('konflikt') ? 'conflict' : 'error')
    }
  }

  function openSaveCopyDialog() {
    setCopyName(createCopyName(name))
    setIsCopyDialogOpen(true)
  }

  async function handleConfirmSaveCopy() {
    if (!currentPlan || !copyName.trim()) {
      setError('Ange ett namn innan du sparar kopian.')
      setSaveState('error')
      return
    }

    setSaveState('saving')
    setError('')

    try {
      const created = await createFlightPlan({
        name: copyName.trim(),
        payload: currentPlan,
      })

      setIsCopyDialogOpen(false)
      setInitialPlan(created.payload)
      setCurrentPlan(created.payload)
      setName(created.name)
      setRecordId(created.id)
      setBaseUpdatedAt(created.updatedAt)
      setPersistedSnapshot({
        name: created.name,
        plan: created.payload,
      })
      setSaveState('saved')
      navigate(`/app/flightplans/${created.id}`, { replace: true })
    } catch (nextError) {
      const message = getErrorMessage(nextError, 'Kunde inte spara kopian.')
      setError(message)
      setSaveState(message.toLowerCase().includes('konflikt') ? 'conflict' : 'error')
    }
  }

  function openClearRouteDialog() {
    setIsClearRouteDialogOpen(true)
  }

  function handleConfirmClearRoute() {
    if (!currentPlan) {
      setIsClearRouteDialogOpen(false)
      return
    }

    const clearedPlan = {
      ...currentPlan,
      routeLegs: [],
    }

    setInitialPlan(clearedPlan)
    setCurrentPlan(clearedPlan)
    setSaveState('dirty')
    setError('')
    setEditorRevision((current) => current + 1)
    setIsClearRouteDialogOpen(false)
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
      {error && <p className="account-error editor-toolbar__error">{error}</p>}

      <FlightplanApp
        key={`${recordId ?? 'new'}:${baseUpdatedAt ?? 'draft'}:${editorRevision}`}
        initialPlan={initialPlan}
        documentTitleSlot={
          <input
            className="fp-document-title-input"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setSaveState('dirty')
            }}
            placeholder="Namnge färdplanen"
          />
        }
        documentToolbarSlot={
          <>
            <div className="fp-editor-toolbar__actions">
              <Link to="/app/flightplans" className="button-link">
                Till listan
              </Link>
              {recordId && (
                <button type="button" onClick={openSaveCopyDialog} disabled={saveState === 'saving'}>
                  Spara kopia
                </button>
              )}
              <button type="button" onClick={handleSave} disabled={saveState === 'saving' || !hasUnsavedChanges}>
                {saveState === 'saving' ? 'Sparar...' : 'Spara'}
              </button>
              <button
                type="button"
                className="button-link button-link--danger"
                onClick={openClearRouteDialog}
                disabled={saveState === 'saving' || !currentPlan || currentPlan.routeLegs.length === 0}
              >
                Rensa färdväg
              </button>
            </div>
            <div className="fp-editor-toolbar__status">
              <span className={`resource-pill resource-pill--${displaySaveState}`}>{getSaveLabel(displaySaveState)}</span>
              <span className={`resource-pill ${isOnline ? '' : 'resource-pill--warning'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </>
        }
        onPlanChange={(nextPlan) => {
          if (!didHydrateRef.current) {
            return
          }

          setCurrentPlan(nextPlan)
          setSaveState((current) => (current === 'saving' ? current : current === 'error' || current === 'conflict' ? current : 'idle'))
        }}
      />

      {isCopyDialogOpen && (
        <div className="dialog-backdrop" onClick={() => setIsCopyDialogOpen(false)}>
          <section className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h2>Spara kopia</h2>
            <p>Ange namnet på den nya färdplanen innan kopian sparas.</p>
            <label className="dialog-field">
              <span>Namn</span>
              <input value={copyName} onChange={(event) => setCopyName(event.target.value)} autoFocus />
            </label>
            <div className="dialog-actions">
              <button type="button" className="button-link" onClick={() => setIsCopyDialogOpen(false)}>
                Avbryt
              </button>
              <button type="button" onClick={handleConfirmSaveCopy} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Sparar...' : 'Spara kopia'}
              </button>
            </div>
          </section>
        </div>
      )}

      {isClearRouteDialogOpen && (
        <div className="dialog-backdrop" onClick={() => setIsClearRouteDialogOpen(false)}>
          <section className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h2>Rensa färdväg</h2>
            <p>Detta tar bort alla waypoints i färdvägen. Vill du fortsätta?</p>
            <div className="dialog-actions">
              <button type="button" className="button-link" onClick={() => setIsClearRouteDialogOpen(false)}>
                Avbryt
              </button>
              <button type="button" className="button-link button-link--danger" onClick={handleConfirmClearRoute}>
                Rensa färdväg
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
