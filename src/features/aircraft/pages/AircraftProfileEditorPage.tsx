import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { useAuth } from '../../auth/hooks/useAuth'
import { createAircraftProfile, getAircraftProfileById, updateAircraftProfile } from '../api/aircraftProfilesRepository'
import { lookupAircraftRegistry } from '../api/aircraftRegistry'
import type { AircraftProfile, AircraftStation, FuelTank, MeasurementUnit, MeasurementValue } from '../profileTypes'
import {
  applyRegistrySnapshot,
  buildRegistryConflicts,
  createEmptyAircraftProfile,
  createMeasurement,
  ensureDisplayName,
  formatMeasurement,
  normalizeRegistration,
  resolveConflict,
  sanitizeAircraftProfile,
} from '../profileUtils'
import { parseSkyDemonAircraftXml } from '../skydemon'
import './aircraft.css'

function getEditorTitle(profile: AircraftProfile) {
  return profile.displayName || profile.identity.registration || 'Ny flygplansprofil'
}

function createStation(kind: AircraftStation['kind'] = 'generic'): AircraftStation {
  return {
    id: `station-${crypto.randomUUID()}`,
    name: '',
    kind,
    arm: null,
    defaultWeight: null,
    maxWeight: null,
  }
}

function createFuelTank(): FuelTank {
  return {
    id: `fuel-${crypto.randomUUID()}`,
    name: '',
    arm: null,
    capacity: null,
    unusable: null,
    defaultFuel: null,
  }
}

function createOptionalMeasurement(
  rawValue: string,
  originalUnit: MeasurementUnit,
  canonicalUnit: MeasurementUnit,
) {
  const normalized = rawValue.replace(',', '.').trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return createMeasurement(parsed, originalUnit, canonicalUnit)
}

function getMeasurementInputValue(value: MeasurementValue | null, unit: MeasurementUnit) {
  if (!value) {
    return ''
  }

  if (value.originalUnit === unit && value.originalValue != null) {
    return String(value.originalValue)
  }

  return String(value.value)
}

type MeasurementFieldProps = {
  label: string
  value: MeasurementValue | null
  sourceUnit: MeasurementUnit
  canonicalUnit: MeasurementUnit
  unitAccent?: 'metric' | 'imperial'
  onChange: (nextValue: MeasurementValue | null) => void
}

function MeasurementField({
  label,
  value,
  sourceUnit,
  canonicalUnit,
  unitAccent = sourceUnit === canonicalUnit ? 'metric' : 'imperial',
  onChange,
}: MeasurementFieldProps) {
  return (
    <label className="aircraft-field">
      <span>{label}</span>
      <div className={`aircraft-unit-input aircraft-unit-input--${unitAccent}`}>
        <input
          value={getMeasurementInputValue(value, sourceUnit)}
          onChange={(event) => onChange(createOptionalMeasurement(event.target.value, sourceUnit, canonicalUnit))}
          inputMode="decimal"
        />
        <strong>{sourceUnit}</strong>
      </div>
      {value && sourceUnit !== canonicalUnit && (
        <small>{`${value.value} ${canonicalUnit} sparas internt`}</small>
      )}
    </label>
  )
}

export function AircraftProfileEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState<AircraftProfile | null>(null)
  const [recordUpdatedAt, setRecordUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let isActive = true

    async function loadProfile() {
      if (!user) {
        return
      }

      setLoading(true)
      setError('')

      try {
        if (!id) {
          if (isActive) {
            setProfile(createEmptyAircraftProfile())
            setRecordUpdatedAt(null)
          }
          return
        }

        const record = await getAircraftProfileById(id)
        if (!isActive) {
          return
        }

        if (!record) {
          setError('Flygplansprofilen kunde inte hittas.')
          return
        }

        setProfile(record.payload)
        setRecordUpdatedAt(record.updatedAt)
      } catch (nextError) {
        if (isActive) {
          setError(getErrorMessage(nextError, 'Kunde inte ladda flygplansprofilen.'))
        }
      } finally {
        if (isActive) {
          setLoading(false)
        }
      }
    }

    void loadProfile()
    return () => {
      isActive = false
    }
  }, [id, user])

  async function handleLookup() {
    if (!profile) {
      return
    }

    const registration = normalizeRegistration(profile.identity.registration)
    if (!registration) {
      setError('Ange registrering innan registeruppslag.')
      return
    }

    setLookupLoading(true)
    setError('')

    try {
      const snapshot = await lookupAircraftRegistry(registration)
      setProfile((current) => {
        if (!current) {
          return current
        }

        const conflicts = buildRegistryConflicts(current, snapshot)
        return {
          ...applyRegistrySnapshot(current, snapshot),
          conflicts,
        }
      })
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte hämta data från Transportstyrelsen.'))
    } finally {
      setLookupLoading(false)
    }
  }

  async function handleImport(file: File) {
    setImportLoading(true)
    setError('')

    try {
      const xmlText = await file.text()
      const imported = parseSkyDemonAircraftXml(xmlText, file.name)
      const nextRegistration = normalizeRegistration(imported.identity.registration)

      if (nextRegistration) {
        try {
          const snapshot = await lookupAircraftRegistry(nextRegistration)
          const prefixed = applyRegistrySnapshot(imported, snapshot)
          prefixed.conflicts = buildRegistryConflicts(imported, snapshot)
          setProfile(prefixed)
          return
        } catch {
          // Importen ska fungera även utan registerträff.
        }
      }

      setProfile(imported)
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte importera SkyDemon-profilen.'))
    } finally {
      setImportLoading(false)
    }
  }

  async function handleSave() {
    if (!profile) {
      return
    }

    setSaving(true)
    setError('')

    try {
      const sanitized = sanitizeAircraftProfile({
        ...profile,
        displayName: ensureDisplayName(profile),
      })

      const input = {
        name: sanitized.displayName,
        registration: sanitized.identity.registration,
        typeName: sanitized.identity.model,
        payload: sanitized,
      }

      if (id) {
        const updated = await updateAircraftProfile(id, input, recordUpdatedAt)
        setProfile(updated.payload)
        setRecordUpdatedAt(updated.updatedAt)
      } else {
        const created = await createAircraftProfile(input)
        navigate(`/app/aircraft/${created.id}`, { replace: true })
      }
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara flygplansprofilen.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !profile) {
    return <section className="app-panel"><div className="app-card">Laddar flygplansprofil...</div></section>
  }

  return (
    <section className="app-panel aircraft-editor">
      <div className="app-panel__header">
        <div>
          <p className="app-eyebrow">Flygplansprofiler</p>
          <h1>{getEditorTitle(profile)}</h1>
          <p>Redigera grunddata, import, enheter och vikt & balans i samma profil.</p>
        </div>
        <div className="resource-list__actions">
          <Link to="/app/aircraft" className="button-link">Till listan</Link>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Sparar...' : 'Spara profil'}
          </button>
        </div>
      </div>

      {error && <p className="account-error">{error}</p>}

      <div className="aircraft-editor__grid">
        <section className="app-card aircraft-section">
          <div className="aircraft-section__header">
            <div>
              <h2>Identitet</h2>
              <p>Registerdata är förifyllning och är alltid redigerbar.</p>
            </div>
            <div className="resource-list__actions">
              <button type="button" onClick={handleLookup} disabled={lookupLoading}>
                {lookupLoading ? 'Hämtar...' : 'Hämta från registret'}
              </button>
              <label className="button-link">
                {importLoading ? 'Importerar...' : 'Importera .aircraft'}
                <input
                  type="file"
                  accept=".aircraft,.xml,text/xml"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                      void handleImport(file)
                    }
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          <div className="aircraft-fields">
            <label className="aircraft-field">
              <span>Profilnamn</span>
              <input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} />
            </label>
            <label className="aircraft-field">
              <span>Registrering</span>
              <input
                value={profile.identity.registration}
                onChange={(event) => setProfile({
                  ...profile,
                  identity: { ...profile.identity, registration: normalizeRegistration(event.target.value) },
                })}
              />
            </label>
            <label className="aircraft-field">
              <span>Tillverkare</span>
              <input value={profile.identity.manufacturer} onChange={(event) => setProfile({ ...profile, identity: { ...profile.identity, manufacturer: event.target.value } })} />
            </label>
            <label className="aircraft-field">
              <span>Modell</span>
              <input value={profile.identity.model} onChange={(event) => setProfile({ ...profile, identity: { ...profile.identity, model: event.target.value } })} />
            </label>
            <label className="aircraft-field">
              <span>Variant</span>
              <input value={profile.identity.variant} onChange={(event) => setProfile({ ...profile, identity: { ...profile.identity, variant: event.target.value } })} />
            </label>
            <label className="aircraft-field">
              <span>Serienummer</span>
              <input value={profile.identity.serialNumber} onChange={(event) => setProfile({ ...profile, identity: { ...profile.identity, serialNumber: event.target.value } })} />
            </label>
            <label className="aircraft-field">
              <span>Tillverkningsår</span>
              <input
                value={profile.identity.yearOfManufacture ?? ''}
                inputMode="numeric"
                onChange={(event) => setProfile({
                  ...profile,
                  identity: { ...profile.identity, yearOfManufacture: event.target.value ? Number(event.target.value) : null },
                })}
              />
            </label>
            <label className="aircraft-field aircraft-field--wide">
              <span>Registrerad ägare</span>
              <input value={profile.identity.registeredOwner} onChange={(event) => setProfile({ ...profile, identity: { ...profile.identity, registeredOwner: event.target.value } })} />
            </label>
          </div>

          {profile.registrySnapshot && (
            <div className="aircraft-note">
              Senaste registerhämtning: {new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.registrySnapshot.fetchedAt))}
            </div>
          )}
        </section>

        <section className="app-card aircraft-section">
          <div className="aircraft-section__header">
            <div>
              <h2>Enheter</h2>
              <p>Profilen sparar canonical data internt men behåller originalenheter för jämförelse.</p>
            </div>
          </div>

          <div className="aircraft-fields">
            <label className="aircraft-field">
              <span>TAS i färdplan</span>
              <select
                value={profile.planningDefaults.tasInputUnit}
                onChange={(event) => setProfile({
                  ...profile,
                  planningDefaults: { ...profile.planningDefaults, tasInputUnit: event.target.value as 'kt' | 'mph' },
                  unitPreferences: { ...profile.unitPreferences, tas: event.target.value as 'kt' | 'mph' },
                })}
              >
                <option value="kt">kt</option>
                <option value="mph">mph</option>
              </select>
            </label>
            <label className="aircraft-field">
              <span>Viktkälla</span>
              <select
                value={profile.unitPreferences.weight}
                onChange={(event) => setProfile({ ...profile, unitPreferences: { ...profile.unitPreferences, weight: event.target.value as 'kg' | 'lb' } })}
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </label>
            <label className="aircraft-field">
              <span>Bränslekälla</span>
              <select
                value={profile.unitPreferences.fuelVolume}
                onChange={(event) => setProfile({ ...profile, unitPreferences: { ...profile.unitPreferences, fuelVolume: event.target.value as 'l' | 'gal_us' } })}
              >
                <option value="l">liter</option>
                <option value="gal_us">US gal</option>
              </select>
            </label>
            <label className="aircraft-field">
              <span>Armkälla</span>
              <select
                value={profile.unitPreferences.arm}
                onChange={(event) => setProfile({ ...profile, unitPreferences: { ...profile.unitPreferences, arm: event.target.value as 'mm' | 'in' } })}
              >
                <option value="mm">mm</option>
                <option value="in">in</option>
              </select>
            </label>
          </div>

          <div className="aircraft-unit-preview">
            <div className={`aircraft-unit-chip aircraft-unit-chip--${profile.planningDefaults.tasInputUnit === 'mph' ? 'imperial' : 'metric'}`}>
              TAS-kolumn i färdplan: {profile.planningDefaults.tasInputUnit}
            </div>
            <p>Vind och GS fortsätter i kt. TAS får en egen tydlig enhetsmarkering i färdplanen.</p>
          </div>
        </section>

        <section className="app-card aircraft-section">
          <div className="aircraft-section__header">
            <div>
              <h2>Vikt & balans</h2>
              <p>Tomdata, MTOW, stationer och bränsletankar sparas generiskt.</p>
            </div>
          </div>

          <div className="aircraft-fields">
            <MeasurementField
              label="Tomvikt"
              value={profile.weightBalance.emptyWeight}
              sourceUnit={profile.unitPreferences.weight}
              canonicalUnit="kg"
              unitAccent={profile.unitPreferences.weight === 'lb' ? 'imperial' : 'metric'}
              onChange={(nextValue) => setProfile({ ...profile, weightBalance: { ...profile.weightBalance, emptyWeight: nextValue } })}
            />
            <MeasurementField
              label="Max startvikt"
              value={profile.weightBalance.maxTakeoffWeight}
              sourceUnit={profile.unitPreferences.weight}
              canonicalUnit="kg"
              unitAccent={profile.unitPreferences.weight === 'lb' ? 'imperial' : 'metric'}
              onChange={(nextValue) => setProfile({ ...profile, weightBalance: { ...profile.weightBalance, maxTakeoffWeight: nextValue } })}
            />
            <MeasurementField
              label="Tom arm"
              value={profile.weightBalance.emptyArm}
              sourceUnit={profile.unitPreferences.arm}
              canonicalUnit="mm"
              unitAccent={profile.unitPreferences.arm === 'in' ? 'imperial' : 'metric'}
              onChange={(nextValue) => setProfile({ ...profile, weightBalance: { ...profile.weightBalance, emptyArm: nextValue } })}
            />
          </div>

          <div className="aircraft-subsection">
            <div className="aircraft-subsection__header">
              <h3>Stationer</h3>
              <button type="button" onClick={() => setProfile({ ...profile, weightBalance: { ...profile.weightBalance, stations: [...profile.weightBalance.stations, createStation()] } })}>
                Lägg till station
              </button>
            </div>
            <div className="aircraft-list">
              {profile.weightBalance.stations.map((station) => (
                <article className="aircraft-list__row" key={station.id}>
                  <input
                    value={station.name}
                    placeholder="Stationsnamn"
                    onChange={(event) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        stations: profile.weightBalance.stations.map((item) => item.id === station.id ? { ...item, name: event.target.value } : item),
                      },
                    })}
                  />
                  <select
                    value={station.kind}
                    onChange={(event) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        stations: profile.weightBalance.stations.map((item) => item.id === station.id ? { ...item, kind: event.target.value as AircraftStation['kind'] } : item),
                      },
                    })}
                  >
                    <option value="seat">Sits</option>
                    <option value="baggage">Bagage</option>
                    <option value="generic">Generisk</option>
                  </select>
                  <MeasurementField
                    label="Arm"
                    value={station.arm}
                    sourceUnit={profile.unitPreferences.arm}
                    canonicalUnit="mm"
                    unitAccent={profile.unitPreferences.arm === 'in' ? 'imperial' : 'metric'}
                    onChange={(nextValue) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        stations: profile.weightBalance.stations.map((item) => item.id === station.id ? { ...item, arm: nextValue } : item),
                      },
                    })}
                  />
                  <MeasurementField
                    label="Defaultvikt"
                    value={station.defaultWeight}
                    sourceUnit={profile.unitPreferences.weight}
                    canonicalUnit="kg"
                    unitAccent={profile.unitPreferences.weight === 'lb' ? 'imperial' : 'metric'}
                    onChange={(nextValue) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        stations: profile.weightBalance.stations.map((item) => item.id === station.id ? { ...item, defaultWeight: nextValue } : item),
                      },
                    })}
                  />
                  <button
                    type="button"
                    className="button-link button-link--danger"
                    onClick={() => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        stations: profile.weightBalance.stations.filter((item) => item.id !== station.id),
                      },
                    })}
                  >
                    Ta bort
                  </button>
                </article>
              ))}
            </div>
          </div>

          <div className="aircraft-subsection">
            <div className="aircraft-subsection__header">
              <h3>Bränsletankar</h3>
              <button type="button" onClick={() => setProfile({ ...profile, weightBalance: { ...profile.weightBalance, fuelTanks: [...profile.weightBalance.fuelTanks, createFuelTank()] } })}>
                Lägg till tank
              </button>
            </div>
            <div className="aircraft-list">
              {profile.weightBalance.fuelTanks.map((tank) => (
                <article className="aircraft-list__row" key={tank.id}>
                  <input
                    value={tank.name}
                    placeholder="Tanknamn"
                    onChange={(event) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        fuelTanks: profile.weightBalance.fuelTanks.map((item) => item.id === tank.id ? { ...item, name: event.target.value } : item),
                      },
                    })}
                  />
                  <MeasurementField
                    label="Arm"
                    value={tank.arm}
                    sourceUnit={profile.unitPreferences.arm}
                    canonicalUnit="mm"
                    unitAccent={profile.unitPreferences.arm === 'in' ? 'imperial' : 'metric'}
                    onChange={(nextValue) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        fuelTanks: profile.weightBalance.fuelTanks.map((item) => item.id === tank.id ? { ...item, arm: nextValue } : item),
                      },
                    })}
                  />
                  <MeasurementField
                    label="Kapacitet"
                    value={tank.capacity}
                    sourceUnit={profile.unitPreferences.fuelVolume}
                    canonicalUnit="l"
                    unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
                    onChange={(nextValue) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        fuelTanks: profile.weightBalance.fuelTanks.map((item) => item.id === tank.id ? { ...item, capacity: nextValue } : item),
                      },
                    })}
                  />
                  <button
                    type="button"
                    className="button-link button-link--danger"
                    onClick={() => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        fuelTanks: profile.weightBalance.fuelTanks.filter((item) => item.id !== tank.id),
                      },
                    })}
                  >
                    Ta bort
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="app-card aircraft-section">
          <div className="aircraft-section__header">
            <div>
              <h2>Performance & bränsle</h2>
              <p>Standardprofilen används som framtida grund för färdplanering och importjämförelse.</p>
            </div>
          </div>
          <div className="aircraft-fields">
            <MeasurementField
              label="Taxi fuel"
              value={profile.fuel.taxiFuel}
              sourceUnit={profile.unitPreferences.fuelVolume}
              canonicalUnit="l"
              unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
              onChange={(nextValue) => setProfile({ ...profile, fuel: { ...profile.fuel, taxiFuel: nextValue } })}
            />
            <MeasurementField
              label="Landing fuel"
              value={profile.fuel.landingFuel}
              sourceUnit={profile.unitPreferences.fuelVolume}
              canonicalUnit="l"
              unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
              onChange={(nextValue) => setProfile({ ...profile, fuel: { ...profile.fuel, landingFuel: nextValue } })}
            />
            <MeasurementField
              label="Glidefart"
              value={profile.performance.glideAirspeed}
              sourceUnit={profile.planningDefaults.tasInputUnit}
              canonicalUnit="kt"
              unitAccent={profile.planningDefaults.tasInputUnit === 'mph' ? 'imperial' : 'metric'}
              onChange={(nextValue) => setProfile({ ...profile, performance: { ...profile.performance, glideAirspeed: nextValue } })}
            />
            <label className="aircraft-field">
              <span>Service ceiling (ft)</span>
              <input
                value={profile.performance.serviceCeilingFt ?? ''}
                inputMode="numeric"
                onChange={(event) => setProfile({ ...profile, performance: { ...profile.performance, serviceCeilingFt: event.target.value ? Number(event.target.value) : null } })}
              />
            </label>
            <label className="aircraft-field">
              <span>Reserv minuter</span>
              <input
                value={profile.fuel.reserveMinutes ?? ''}
                inputMode="numeric"
                onChange={(event) => setProfile({
                  ...profile,
                  fuel: { ...profile.fuel, reserveMinutes: event.target.value ? Number(event.target.value) : null },
                  planningDefaults: { ...profile.planningDefaults, reserveMinutes: event.target.value ? Number(event.target.value) : null },
                })}
              />
            </label>
          </div>

          {profile.performance.cruiseProfiles.length > 0 && (
            <div className="aircraft-subsection">
              <div className="aircraft-subsection__header">
                <h3>Cruiseprofiler</h3>
              </div>
              <div className="aircraft-cruise-list">
                {profile.performance.cruiseProfiles.map((cruiseProfile) => (
                  <article key={cruiseProfile.id} className="aircraft-cruise-card">
                    <strong>{cruiseProfile.name}</strong>
                    <span>{cruiseProfile.airspeedType === 'ias' ? 'IAS' : 'TAS'}</span>
                    {cruiseProfile.entries.slice(0, 3).map((entry) => (
                      <div key={`${cruiseProfile.id}-${entry.altitudeFt}`}>
                        {entry.altitudeFt} ft · {formatMeasurement(entry.airspeed, profile.planningDefaults.tasInputUnit)} · {formatMeasurement(entry.fuelBurn, profile.unitPreferences.fuelVolume)}
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        {profile.conflicts.length > 0 && (
          <section className="app-card aircraft-section aircraft-section--conflicts">
            <div className="aircraft-section__header">
              <div>
                <h2>Konflikter att granska</h2>
                <p>Registerdata och import/manuell data skiljer sig för följande fält.</p>
              </div>
            </div>
            <div className="aircraft-conflict-list">
              {profile.conflicts.map((conflict) => (
                <article key={conflict.id} className="aircraft-conflict">
                  <strong>{conflict.label}</strong>
                  <div>Transportstyrelsen: {conflict.registryValue}</div>
                  <div>Nuvarande/import: {conflict.importValue}</div>
                  <div className="resource-list__actions">
                    <button type="button" onClick={() => setProfile(resolveConflict(profile, conflict.id, 'registry'))}>
                      Använd register
                    </button>
                    <button type="button" className="button-link" onClick={() => setProfile(resolveConflict(profile, conflict.id, 'import'))}>
                      Behåll nuvarande
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
