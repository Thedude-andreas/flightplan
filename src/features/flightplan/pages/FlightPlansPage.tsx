import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { createFlightPlan, deleteFlightPlan, listFlightPlans, updateFlightPlan } from '../api/flightPlansRepository'
import { importSmartRoute, type SmartRouteImportSourceType } from '../api/smartRouteImport'
import { preloadSwedishAviationData } from '../aviationData'
import type { FlightPlanRecord } from '../persistenceTypes'
import {
  createFlightPlanFromImportedRoute,
  resolveImportedWaypoints,
  type ResolvedRouteImportWaypoint,
} from '../routeImport'

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

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : ''
      resolve(value.includes(',') ? value.split(',')[1] : value)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Kunde inte läsa filen.'))
    reader.readAsDataURL(file)
  })
}

async function extractFileText(file: File) {
  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data, { type: 'array' })
    return workbook.SheetNames
      .map((sheetName) => {
        const sheet = workbook.Sheets[sheetName]
        return [`# ${sheetName}`, XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' })].join('\n')
      })
      .join('\n\n')
      .slice(0, 120_000)
  }

  if (
    file.type.startsWith('text/')
    || lowerName.endsWith('.csv')
    || lowerName.endsWith('.tsv')
    || lowerName.endsWith('.gpx')
    || lowerName.endsWith('.kml')
    || lowerName.endsWith('.geojson')
    || lowerName.endsWith('.json')
  ) {
    return (await file.text()).slice(0, 120_000)
  }

  return ''
}

function getSourceType(file: File | null): SmartRouteImportSourceType {
  if (!file) {
    return 'text'
  }

  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
    return 'spreadsheet'
  }

  if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return 'pdf'
  }

  if (file.type.startsWith('image/')) {
    return 'image'
  }

  return 'file'
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(value)
}

export function FlightPlansPage() {
  const location = useLocation()
  const mapPanelSearch = new URLSearchParams(location.search).get('from') === 'map' ? location.search : ''
  const [plans, setPlans] = useState<FlightPlanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copySource, setCopySource] = useState<FlightPlanRecord | null>(null)
  const [copyName, setCopyName] = useState('')
  const [renameSource, setRenameSource] = useState<FlightPlanRecord | null>(null)
  const [renameName, setRenameName] = useState('')
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResultName, setImportResultName] = useState('')
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [importDiagnostics, setImportDiagnostics] = useState('')
  const [importedWaypoints, setImportedWaypoints] = useState<ResolvedRouteImportWaypoint[]>([])

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

  function openImportDialog() {
    setIsImportDialogOpen(true)
    setImportText('')
    setImportFile(null)
    setImportWarnings([])
    setImportDiagnostics('')
    setImportedWaypoints([])
    setImportResultName('')
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

  async function handleSmartImport() {
    const trimmedText = importText.trim()
    if (!trimmedText && !importFile) {
      setError('Klistra in en rutt eller välj en fil först.')
      return
    }

    setImporting(true)
    setError('')
    setImportWarnings([])
    setImportDiagnostics('')
    setImportedWaypoints([])

    try {
      await preloadSwedishAviationData()
      const fileText = importFile ? await extractFileText(importFile) : ''
      const shouldSendFile = Boolean(importFile && (importFile.type.startsWith('image/') || importFile.type === 'application/pdf'))
      const result = await importSmartRoute({
        text: [trimmedText, fileText].filter(Boolean).join('\n\n'),
        sourceType: getSourceType(importFile),
        fileName: importFile?.name,
        fileType: importFile?.type || undefined,
        fileSizeBytes: importFile?.size,
        fileBase64: shouldSendFile && importFile ? await fileToBase64(importFile) : undefined,
      })
      const resolved = await resolveImportedWaypoints(result.waypoints)

      setImportResultName(result.routeName || 'Importerad rutt')
      setImportWarnings(result.warnings ?? [])
      setImportedWaypoints(resolved)
      if (result.diagnostics) {
        const tokens = [
          result.diagnostics.usage.input_tokens ? `${result.diagnostics.usage.input_tokens} in` : '',
          result.diagnostics.usage.output_tokens ? `${result.diagnostics.usage.output_tokens} ut` : '',
        ].filter(Boolean).join(', ')
        setImportDiagnostics([
          result.diagnostics.model ? `Modell: ${result.diagnostics.model}` : 'Enkel parser användes',
          tokens ? `Tokens: ${tokens}` : '',
          `Beräknad kostnad: ${formatUsd(result.diagnostics.estimatedCostUsd)}`,
        ].filter(Boolean).join(' · '))
      }
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte tolka rutten.'))
    } finally {
      setImporting(false)
    }
  }

  async function handleCreateImportedPlan() {
    const usablePoints = importedWaypoints.filter((point) => point.lat != null && point.lon != null)
    if (usablePoints.length < 2) {
      setError('Minst två placerade punkter behövs innan rutten kan skapas.')
      return
    }

    setError('')

    try {
      const plan = createFlightPlanFromImportedRoute(importResultName, importedWaypoints)
      const created = await createFlightPlan({
        name: importResultName || 'Importerad rutt',
        payload: plan,
      })
      setPlans((current) => [created, ...current])
      setIsImportDialogOpen(false)
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte skapa färdplanen från importen.'))
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
          <button type="button" onClick={openImportDialog}>
            Importera rutt
          </button>
          <Link to={`/app/flightplans/new${mapPanelSearch}`} className="button-link button-link--primary">
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
                <Link to={`/app/flightplans/${plan.id}${mapPanelSearch}`} className="button-link">
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

      {isImportDialogOpen && (
        <div className="dialog-backdrop" onClick={() => setIsImportDialogOpen(false)}>
          <section className="dialog-card smart-route-import" onClick={(event) => event.stopPropagation()}>
            <div>
              <p className="app-eyebrow">Smart ruttimport</p>
              <h2>Importera rutt</h2>
            </div>
            <label className="dialog-field">
              <span>Klistra in rutt eller waypointlista</span>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="ESPA-Haparanda-Tjäruträsk-Töre-ESPA"
                rows={5}
              />
            </label>
            <label className="dialog-field">
              <span>Fil eller skärmdump</span>
              <input
                type="file"
                accept=".txt,.csv,.tsv,.xlsx,.xls,.gpx,.kml,.geojson,.json,.pdf,image/*"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <div className="resource-list__actions">
              <button type="button" disabled={importing} onClick={handleSmartImport}>
                {importing ? 'Tolkar...' : 'Tolka rutt'}
              </button>
              <button type="button" className="button-link" onClick={() => setIsImportDialogOpen(false)}>
                Avbryt
              </button>
            </div>

            {importDiagnostics && <p className="smart-route-import__diagnostics">{importDiagnostics}</p>}

            {importWarnings.length > 0 && (
              <div className="smart-route-import__warnings">
                {importWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}

            {importedWaypoints.length > 0 && (
              <div className="smart-route-import__review">
                <div className="resource-list__header">
                  <div>
                    <h3>{importResultName}</h3>
                    <p>{importedWaypoints.filter((point) => point.lat != null && point.lon != null).length} av {importedWaypoints.length} punkter kan placeras.</p>
                  </div>
                </div>
                <ol className="smart-route-import__points">
                  {importedWaypoints.map((point, index) => (
                    <li key={`${point.raw}-${index}`} className={`smart-route-import__point is-${point.status}`}>
                      <div>
                        <strong>{point.name}</strong>
                        <span>{point.source} · {Math.round(point.confidence * 100)}%</span>
                        {point.candidates.length > 1 && (
                          <small>Alternativ: {point.candidates.slice(1, 4).map((candidate) => candidate.name).join(', ')}</small>
                        )}
                      </div>
                      <span className={`resource-pill resource-pill--${point.status === 'unresolved' ? 'error' : point.status === 'ambiguous' ? 'warning' : 'saved'}`}>
                        {point.status === 'unresolved' ? 'Saknas' : point.status === 'ambiguous' ? 'Osäker' : 'OK'}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="dialog-actions">
                  <button type="button" disabled={importedWaypoints.filter((point) => point.lat != null && point.lon != null).length < 2} onClick={handleCreateImportedPlan}>
                    Skapa färdplan
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
