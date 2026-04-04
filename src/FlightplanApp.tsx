import { useEffect, useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import './features/flightplan/flightplan.css'
import { aircraftProfiles, createInitialFlightPlan } from './features/flightplan/data'
import { calculateFlightPlan, formatNumber, formatTimeFromMinutes } from './features/flightplan/calculations'
import { snapCoordinate } from './features/flightplan/coordinates'
import { legsToWaypoints, waypointsToLegs } from './features/flightplan/gazetteer'
import { FlightplanMapEditor } from './features/flightplan/FlightplanMapEditor'
import type { AircraftProfile, FlightPlanInput } from './features/flightplan/types'

type EditorPanel = 'fuel' | 'weightBalance' | 'performance' | 'aircraft'
type WorkspaceTab = 'flightplan' | 'map' | 'print' | 'settings'
type RouteRow = Record<string, string | number>
type RowContextMenuState = { x: number; y: number; rowIndex: number } | null

const printLogoSrc = `${import.meta.env.BASE_URL}lbfk-logo.png`
const contextMenuSize = { width: 220, height: 112, margin: 12 }

function clampContextMenuPosition(x: number, y: number) {
  const maxX = window.innerWidth - contextMenuSize.width - contextMenuSize.margin
  const maxY = window.innerHeight - contextMenuSize.height - contextMenuSize.margin

  return {
    x: Math.max(contextMenuSize.margin, Math.min(x, maxX)),
    y: Math.max(contextMenuSize.margin, Math.min(y, maxY)),
  }
}

function emptyRouteRow(index: number): RouteRow {
  return {
    index,
    wind: '',
    tas: '',
    tt: '',
    wca: '',
    th: '',
    variation: '',
    mh: '',
    altitude: '',
    segment: '',
    navRef: '',
    gs: '',
    distInt: '',
    distAcc: '',
    timeInt: '',
    timeAcc: '',
    notes: '',
  }
}

function createRouteRows(
  plan: FlightPlanInput,
  derived: ReturnType<typeof calculateFlightPlan>,
  targetLength?: number,
): RouteRow[] {
  const hasPendingStartPoint =
    plan.routeLegs.length === 1 &&
    plan.routeLegs[0].from.lat === plan.routeLegs[0].to.lat &&
    plan.routeLegs[0].from.lon === plan.routeLegs[0].to.lon

  if (hasPendingStartPoint) {
    if (!targetLength) {
      return []
    }

    return Array.from({ length: targetLength }, (_, index) => emptyRouteRow(index))
  }

  const rows: RouteRow[] = derived.routeLegs.map((leg, index) => ({
    index,
    wind: leg.windText,
    tas: plan.routeLegs[index].tasKt,
    tt: leg.trueTrack,
    wca: leg.windCorrectionAngle,
    th: leg.trueHeading,
    variation: plan.routeLegs[index].variation,
    mh: leg.magneticHeading,
    altitude: plan.routeLegs[index].altitude,
    segment: leg.segmentName,
    navRef: plan.routeLegs[index].navRef,
    gs: leg.groundSpeedKt,
    distInt: leg.distanceNm,
    distAcc: leg.accumulatedDistanceNm,
    timeInt: formatTimeFromMinutes(leg.legTimeMinutes),
    timeAcc: formatTimeFromMinutes(leg.accumulatedTimeMinutes),
    notes: plan.routeLegs[index].notes,
  }))

  if (!targetLength || rows.length >= targetLength) {
    return rows
  }

  return rows.concat(Array.from({ length: targetLength - rows.length }, (_, index) => emptyRouteRow(rows.length + index)))
}

function createAircraftDraft(source?: AircraftProfile, seed = 1): AircraftProfile {
  if (source) {
    return {
      ...source,
      registration: `SE-N${seed.toString().padStart(2, '0')}`,
      typeName: `${source.typeName} kopia`,
      callsign: `${source.callsign} Copy`,
      armsMm: { ...source.armsMm },
      limits: { ...source.limits },
      performance: { ...source.performance },
    }
  }

  return {
    registration: `SE-N${seed.toString().padStart(2, '0')}`,
    typeName: 'Ny typ',
    callsign: 'Ny callsign',
    cruiseTasKt: 100,
    fuelBurnLph: 32,
    fuelDensityKgPerLiter: 0.72,
    emptyWeightKg: 700,
    emptyMomentKgMm: 240000,
    armsMm: {
      frontLeft: 940,
      frontRight: 940,
      rearLeft: 1830,
      rearRight: 1830,
      baggage: 2480,
      fuel: 1210,
    },
    limits: {
      maxTowKg: 1100,
      minArmMm: 910,
      maxArmMm: 1220,
    },
    performance: {
      takeoff50FtM: 500,
      landing50FtM: 420,
    },
  }
}

function cloneAircraftProfile(source: AircraftProfile): AircraftProfile {
  return {
    ...source,
    armsMm: { ...source.armsMm },
    limits: { ...source.limits },
    performance: { ...source.performance },
  }
}

function cloneFlightPlan(plan: FlightPlanInput): FlightPlanInput {
  return {
    ...plan,
    header: { ...plan.header },
    routeLegs: plan.routeLegs.map((leg) => ({
      ...leg,
      from: { ...leg.from },
      to: { ...leg.to },
    })),
    radioNav: plan.radioNav.map((entry) => ({ ...entry })),
    performance: { ...plan.performance },
    fuel: { ...plan.fuel },
    weightBalance: { ...plan.weightBalance },
  }
}

type FlightplanAppProps = {
  initialPlan?: FlightPlanInput
  initialAircraftOptions?: AircraftProfile[]
  headerSlot?: ReactNode
  onPlanChange?: (plan: FlightPlanInput) => void
}

export function FlightplanApp({
  initialPlan,
  initialAircraftOptions,
  headerSlot,
  onPlanChange,
}: FlightplanAppProps = {}) {
  const [plan, setPlan] = useState<FlightPlanInput>(() => cloneFlightPlan(initialPlan ?? createInitialFlightPlan()))
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('flightplan')
  const [aircraftOptions, setAircraftOptions] = useState<AircraftProfile[]>(() =>
    (initialAircraftOptions ?? aircraftProfiles).map(cloneAircraftProfile),
  )
  const [settingsIndex, setSettingsIndex] = useState(0)
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState>(null)
  const [focusedLegIndex, setFocusedLegIndex] = useState<number | null>(null)

  const derived = calculateFlightPlan(plan, aircraftOptions)
  const routeRows = useMemo(() => createRouteRows(plan, derived), [plan, derived])
  const printRouteRows = useMemo(() => createRouteRows(plan, derived, 13), [plan, derived])

  useEffect(() => {
    onPlanChange?.(plan)
  }, [onPlanChange, plan])

  const updateHeader = (key: keyof FlightPlanInput['header'], value: string) => {
    setPlan((current) => ({
      ...current,
      header: {
        ...current.header,
        [key]: value,
      },
    }))
  }

  const updatePerformance = (
    key: keyof FlightPlanInput['performance'],
    value: string | number,
  ) => {
    setPlan((current) => ({
      ...current,
      performance: {
        ...current.performance,
        [key]: value,
      },
    }))
  }

  const updateFuel = (key: keyof FlightPlanInput['fuel'], value: string | number | undefined) => {
    setPlan((current) => ({
      ...current,
      fuel: {
        ...current.fuel,
        [key]: value,
      },
    }))
  }

  const updateWeightBalance = (key: keyof FlightPlanInput['weightBalance'], value: number) => {
    setPlan((current) => ({
      ...current,
      weightBalance: {
        ...current.weightBalance,
        [key]: value,
      },
    }))
  }

  const replaceRouteLegs = (routeLegs: FlightPlanInput['routeLegs']) => {
    setPlan((current) => ({
      ...current,
      routeLegs,
    }))
  }

  const addRouteLeg = () => {
    setPlan((current) => {
      const lastLeg = current.routeLegs[current.routeLegs.length - 1]
      const template = lastLeg ?? current.routeLegs[0]

      return {
        ...current,
        routeLegs: [
          ...current.routeLegs,
          {
            ...template,
            from: { ...template.to },
            to: {
              name: `Punkt ${current.routeLegs.length + 1}`,
              lat: snapCoordinate(template.to.lat + 0.25),
              lon: snapCoordinate(template.to.lon + 0.2),
            },
            notes: '',
          },
        ].slice(0, 13),
      }
    })
  }

  const removeWaypointFromRoute = (waypointIndex: number) => {
    if (plan.routeLegs.length <= 1) {
      return
    }

    const waypoints = legsToWaypoints(plan.routeLegs)
    if (waypointIndex < 0 || waypointIndex >= waypoints.length) {
      return
    }

    const nextWaypoints = waypoints.filter((_, index) => index !== waypointIndex)
    if (nextWaypoints.length < 2) {
      return
    }

    setRowContextMenu(null)
    setPlan((current) => ({
      ...current,
      routeLegs: waypointsToLegs(nextWaypoints, current.routeLegs, derived.aircraft.cruiseTasKt),
    }))
  }

  const updateRadioNav = (index: number, key: 'name' | 'frequency', value: string) => {
    setPlan((current) => ({
      ...current,
      radioNav: current.radioNav.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [key]: value } : entry,
      ),
    }))
  }

  const addAircraftConfiguration = () => {
    setAircraftOptions((current) => {
      const next = [...current, createAircraftDraft(current.at(settingsIndex), current.length + 1)]
      setSettingsIndex(next.length - 1)
      return next
    })
    setActiveTab('settings')
  }

  const updateAircraftConfiguration = (
    index: number,
    updater: (aircraft: AircraftProfile) => AircraftProfile,
  ) => {
    setAircraftOptions((current) => {
      const previous = current[index]
      const nextAircraft = updater(previous)
      const next = current.map((aircraft, aircraftIndex) => (aircraftIndex === index ? nextAircraft : aircraft))

      if (plan.aircraftRegistration === previous.registration && nextAircraft.registration !== previous.registration) {
        setPlan((currentPlan) => ({
          ...currentPlan,
          aircraftRegistration: nextAircraft.registration,
        }))
      }

      return next
    })
  }

  const selectedAircraftConfig = aircraftOptions[settingsIndex] ?? aircraftOptions[0]

  return (
    <div className="flightplan-page">
      <header className="fp-page-header fp-no-print">
        <div>
          <p className="fp-eyebrow">Flightplan · allmänflyg · Sverige</p>
          <h1>Flightplan</h1>
          <p className="fp-lede">
            Fristående färdplansverktyg med svensk LFV/AIP-datapipeline, karteditor och utskriftsanpassad driftfärdplan.
          </p>
        </div>
        <div className="fp-page-actions">
          {headerSlot}
          {activeTab === 'print' ? (
            <button type="button" onClick={() => window.print()}>
              Skriv ut formulär
            </button>
          ) : (
            <button type="button" onClick={() => setActiveTab('print')}>
              Gå till skriv ut
            </button>
          )}
        </div>
      </header>

      <div className="fp-tabs fp-no-print" role="tablist" aria-label="Arbetsyta">
        <button type="button" className={activeTab === 'flightplan' ? 'is-active' : ''} onClick={() => setActiveTab('flightplan')}>
          Driftfärdplan
        </button>
        <button type="button" className={activeTab === 'map' ? 'is-active' : ''} onClick={() => setActiveTab('map')}>
          Karta
        </button>
        <button type="button" className={activeTab === 'print' ? 'is-active' : ''} onClick={() => setActiveTab('print')}>
          Skriv ut
        </button>
        <button type="button" className={activeTab === 'settings' ? 'is-active' : ''} onClick={() => setActiveTab('settings')}>
          Inställningar
        </button>
      </div>

      <main className="fp-workspace" onClick={() => setRowContextMenu(null)}>
        {activeTab === 'flightplan' && (
          <div className="fp-tab-panel">
            <section className="fp-document-sheet">
              <FlightPlanDocument
                plan={plan}
                derived={derived}
                routeRows={routeRows}
                onHeaderChange={updateHeader}
                onSectionSelect={setActivePanel}
                onRouteSegmentSelect={(rowIndex) => {
                  setFocusedLegIndex(rowIndex)
                  setActiveTab('map')
                }}
                onOpenAircraftPicker={() => setActivePanel('aircraft')}
                onRadioNavChange={updateRadioNav}
                onAddRouteRow={addRouteLeg}
                onOpenRowMenu={(x, y, rowIndex) => {
                  const clamped = clampContextMenuPosition(x, y)
                  setRowContextMenu({ x: clamped.x, y: clamped.y, rowIndex })
                }}
              />
            </section>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="fp-tab-panel">
            <section className="fp-map-sheet fp-live-map-sheet">
              <FlightplanMapEditor
                plan={plan}
                derived={derived}
                onRouteLegsChange={replaceRouteLegs}
                focusedLegIndex={focusedLegIndex}
              />
            </section>
          </div>
        )}

        {activeTab === 'print' && (
          <div className="fp-document-stack fp-print-stack">
            <section className="fp-document-sheet">
              <FlightPlanDocument
                plan={plan}
                derived={derived}
                routeRows={printRouteRows}
                onHeaderChange={updateHeader}
                onSectionSelect={setActivePanel}
                onRouteSegmentSelect={(rowIndex) => {
                  setFocusedLegIndex(rowIndex)
                  setActiveTab('map')
                }}
                onOpenAircraftPicker={() => setActivePanel('aircraft')}
                onRadioNavChange={updateRadioNav}
              />
            </section>

            <section className="fp-map-sheet">
              <div className="fp-map-header">
                <div>
                  <p className="fp-eyebrow">Ruttöversikt</p>
                  <h2>Kartbild för utskrift</h2>
                </div>
                <div className="fp-map-meta">
                  <span>{plan.header.departureAerodrome}</span>
                  <span>{plan.header.destinationAerodrome}</span>
                  <span>{formatNumber(derived.totals.distanceNm, 1)} nm</span>
                </div>
              </div>
              <RoutePreview legs={plan.routeLegs} />
            </section>
          </div>
        )}

        {activeTab === 'settings' && selectedAircraftConfig && (
          <section className="fp-panel-card fp-settings-card fp-no-print">
            <div className="fp-panel-header">
              <div>
                <p className="fp-panel-eyebrow">Inställningar</p>
                <h2>Flygplanskonfigurationer</h2>
              </div>
              <button type="button" onClick={addAircraftConfiguration}>
                Lägg till flygplan
              </button>
            </div>

            <div className="fp-settings-layout">
              <div className="fp-config-list">
                {aircraftOptions.map((aircraft, index) => (
                  <button
                    key={`${aircraft.registration}-${index}`}
                    type="button"
                    className={index === settingsIndex ? 'is-active' : ''}
                    onClick={() => setSettingsIndex(index)}
                  >
                    <strong>{aircraft.registration}</strong>
                    <span>{aircraft.typeName}</span>
                  </button>
                ))}
              </div>

              <div className="fp-settings-editor">
                <div className="fp-input-grid fp-two-col">
                  <EditorInput
                    label="Registrering"
                    value={selectedAircraftConfig.registration}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, registration: value.toUpperCase() }))}
                  />
                  <EditorInput
                    label="Typ"
                    value={selectedAircraftConfig.typeName}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, typeName: value }))}
                  />
                  <EditorInput
                    label="Callsign"
                    value={selectedAircraftConfig.callsign}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, callsign: value }))}
                  />
                  <EditorNumber
                    label="Cruise TAS kt"
                    value={selectedAircraftConfig.cruiseTasKt}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, cruiseTasKt: value }))}
                  />
                  <EditorNumber
                    label="Förbrukning lit/tim"
                    value={selectedAircraftConfig.fuelBurnLph}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, fuelBurnLph: value }))}
                  />
                  <EditorNumber
                    label="Bränsledensitet kg/l"
                    value={selectedAircraftConfig.fuelDensityKgPerLiter}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, fuelDensityKgPerLiter: value }))}
                  />
                  <EditorNumber
                    label="Tomvikt kg"
                    value={selectedAircraftConfig.emptyWeightKg}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, emptyWeightKg: value }))}
                  />
                  <EditorNumber
                    label="Tommoment"
                    value={selectedAircraftConfig.emptyMomentKgMm}
                    onChange={(value) => updateAircraftConfiguration(settingsIndex, (aircraft) => ({ ...aircraft, emptyMomentKgMm: value }))}
                  />
                  <EditorNumber
                    label="Max TOW kg"
                    value={selectedAircraftConfig.limits.maxTowKg}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        limits: { ...aircraft.limits, maxTowKg: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm min mm"
                    value={selectedAircraftConfig.limits.minArmMm}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        limits: { ...aircraft.limits, minArmMm: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm max mm"
                    value={selectedAircraftConfig.limits.maxArmMm}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        limits: { ...aircraft.limits, maxArmMm: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="T/O 50 ft m"
                    value={selectedAircraftConfig.performance.takeoff50FtM}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        performance: { ...aircraft.performance, takeoff50FtM: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="LDG 50 ft m"
                    value={selectedAircraftConfig.performance.landing50FtM}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        performance: { ...aircraft.performance, landing50FtM: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm fram vänster"
                    value={selectedAircraftConfig.armsMm.frontLeft}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        armsMm: { ...aircraft.armsMm, frontLeft: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm fram höger"
                    value={selectedAircraftConfig.armsMm.frontRight}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        armsMm: { ...aircraft.armsMm, frontRight: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm bak vänster"
                    value={selectedAircraftConfig.armsMm.rearLeft}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        armsMm: { ...aircraft.armsMm, rearLeft: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm bak höger"
                    value={selectedAircraftConfig.armsMm.rearRight}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        armsMm: { ...aircraft.armsMm, rearRight: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm bagage"
                    value={selectedAircraftConfig.armsMm.baggage}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        armsMm: { ...aircraft.armsMm, baggage: value },
                      }))
                    }
                  />
                  <EditorNumber
                    label="Arm bränsle"
                    value={selectedAircraftConfig.armsMm.fuel}
                    onChange={(value) =>
                      updateAircraftConfiguration(settingsIndex, (aircraft) => ({
                        ...aircraft,
                        armsMm: { ...aircraft.armsMm, fuel: value },
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {rowContextMenu && (
        <div
          className="fp-context-menu fp-no-print"
          style={{ left: rowContextMenu.x, top: rowContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => removeWaypointFromRoute(rowContextMenu.rowIndex)}
            disabled={plan.routeLegs.length === 1}
          >
            Ta bort start-waypoint
          </button>
          <button
            type="button"
            onClick={() => removeWaypointFromRoute(rowContextMenu.rowIndex + 1)}
            disabled={plan.routeLegs.length === 1}
          >
            Ta bort slut-waypoint
          </button>
        </div>
      )}

      {activePanel && (
        <div className="fp-overlay-shell fp-no-print" onClick={() => setActivePanel(null)}>
          <section className="fp-overlay-panel" onClick={(event) => event.stopPropagation()}>
            {activePanel === 'aircraft' && (
              <section className="fp-panel-card fp-overlay-card">
                <div className="fp-panel-header">
                  <div>
                    <p className="fp-panel-eyebrow">Flygplansval</p>
                    <h2>Välj flygplan för färdplanen</h2>
                  </div>
                  <button type="button" onClick={() => setActivePanel(null)}>
                    Stäng
                  </button>
                </div>
                <div className="fp-aircraft-picker">
                  {aircraftOptions.map((aircraft) => {
                    const isActive = aircraft.registration === plan.aircraftRegistration
                    return (
                      <button
                        key={aircraft.registration}
                        type="button"
                        className={isActive ? 'is-active' : ''}
                        onClick={() => {
                          setPlan((current) => ({ ...current, aircraftRegistration: aircraft.registration }))
                          setActivePanel(null)
                        }}
                      >
                        <strong>{aircraft.registration}</strong>
                        <span>{aircraft.typeName}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {activePanel === 'fuel' && (
              <section className="fp-panel-card fp-overlay-card">
                <div className="fp-panel-header">
                  <div>
                    <p className="fp-panel-eyebrow">Bränsleeditor</p>
                    <h2>Planerad reserv och extra ombord</h2>
                  </div>
                  <button type="button" onClick={() => setActivePanel(null)}>
                    Stäng
                  </button>
                </div>
                <div className="fp-input-grid">
                  <EditorNumber label="Reserv minuter" value={plan.fuel.reserveMinutes} onChange={(value) => updateFuel('reserveMinutes', value)} />
                  <EditorNumber label="Extra ombord liter" value={plan.fuel.extraOnBoardLiters} onChange={(value) => updateFuel('extraOnBoardLiters', value)} />
                  <EditorNumber label="Förbrukning override lit/tim" value={plan.fuel.burnOverrideLph ?? 0} allowBlank placeholder={String(derived.aircraft.fuelBurnLph)} onChangeOptional={(value) => updateFuel('burnOverrideLph', value)} />
                </div>
                <div className="fp-stat-block">
                  <div><span>Trip</span><strong>{formatNumber(derived.fuel.tripLiters, 1)} l</strong></div>
                  <div><span>Reserv</span><strong>{formatNumber(derived.fuel.reserveLiters, 1)} l</strong></div>
                  <div><span>Total ombord</span><strong>{formatNumber(derived.fuel.totalOnBoardLiters, 1)} l</strong></div>
                </div>
              </section>
            )}

            {activePanel === 'weightBalance' && (
              <section className="fp-panel-card fp-overlay-card">
                <div className="fp-panel-header">
                  <div>
                    <p className="fp-panel-eyebrow">Vikt & balans</p>
                    <h2>Klickbar kabinskiss</h2>
                  </div>
                  <button type="button" onClick={() => setActivePanel(null)}>
                    Stäng
                  </button>
                </div>
                <div className="fp-seat-map">
                  <SeatBox title="Fram vänster" value={plan.weightBalance.frontLeftKg} onChange={(value) => updateWeightBalance('frontLeftKg', value)} />
                  <SeatBox title="Fram höger" value={plan.weightBalance.frontRightKg} onChange={(value) => updateWeightBalance('frontRightKg', value)} />
                  <SeatBox title="Bak vänster" value={plan.weightBalance.rearLeftKg} onChange={(value) => updateWeightBalance('rearLeftKg', value)} />
                  <SeatBox title="Bak höger" value={plan.weightBalance.rearRightKg} onChange={(value) => updateWeightBalance('rearRightKg', value)} />
                  <SeatBox title="Bagage" value={plan.weightBalance.baggageKg} onChange={(value) => updateWeightBalance('baggageKg', value)} baggage />
                </div>
                <div className="fp-stat-block">
                  <div><span>TOW</span><strong>{formatNumber(derived.weightBalance.towKg, 1)} kg</strong></div>
                  <div><span>Arm</span><strong>{formatNumber(derived.weightBalance.armMm)} mm</strong></div>
                  <div><span>Status</span><strong className={derived.weightBalance.withinLimits ? 'fp-status-ok' : 'fp-status-warn'}>{derived.weightBalance.withinLimits ? 'Inom gräns' : 'Utanför gräns'}</strong></div>
                </div>
              </section>
            )}

            {activePanel === 'performance' && (
              <section className="fp-panel-card fp-overlay-card">
                <div className="fp-panel-header">
                  <div>
                    <p className="fp-panel-eyebrow">STOL-editor</p>
                    <h2>Bana, väder och höjd</h2>
                  </div>
                  <button type="button" onClick={() => setActivePanel(null)}>
                    Stäng
                  </button>
                </div>
                <div className="fp-input-grid">
                  <EditorNumber label="Tillgänglig startsträcka m" value={plan.performance.availableTakeoffDistanceM} onChange={(value) => updatePerformance('availableTakeoffDistanceM', value)} />
                  <EditorNumber label="Tillgänglig landningssträcka m" value={plan.performance.availableLandingDistanceM} onChange={(value) => updatePerformance('availableLandingDistanceM', value)} />
                  <EditorNumber label="Fälthöjd ft" value={plan.performance.aerodromeElevationFt} onChange={(value) => updatePerformance('aerodromeElevationFt', value)} />
                  <EditorNumber label="Temperatur °C" value={plan.performance.temperatureC} onChange={(value) => updatePerformance('temperatureC', value)} />
                  <EditorNumber label="Motvind + / medvind -" value={plan.performance.headwindKt} onChange={(value) => updatePerformance('headwindKt', value)} />
                  <label>
                    Beläggning
                    <select
                      value={plan.performance.runwaySurface}
                      onChange={(event) => updatePerformance('runwaySurface', event.target.value as FlightPlanInput['performance']['runwaySurface'])}
                    >
                      <option>Asfalt</option>
                      <option>Gräs</option>
                    </select>
                  </label>
                  <label>
                    Banstatus
                    <select
                      value={plan.performance.runwayCondition}
                      onChange={(event) => updatePerformance('runwayCondition', event.target.value as FlightPlanInput['performance']['runwayCondition'])}
                    >
                      <option>Torr</option>
                      <option>Våt</option>
                      <option>Mjuk</option>
                    </select>
                  </label>
                </div>
                <div className="fp-stat-block">
                  <div><span>Startmarginal</span><strong className={derived.performance.takeoffMarginM >= 0 ? 'fp-status-ok' : 'fp-status-warn'}>{formatNumber(derived.performance.takeoffMarginM)} m</strong></div>
                  <div><span>Landningsmarginal</span><strong className={derived.performance.landingMarginM >= 0 ? 'fp-status-ok' : 'fp-status-warn'}>{formatNumber(derived.performance.landingMarginM)} m</strong></div>
                </div>
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function EditorInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function EditorNumber({
  label,
  value,
  onChange,
  onChangeOptional,
  placeholder,
  allowBlank = false,
}: {
  label: string
  value: number
  onChange?: (value: number) => void
  onChangeOptional?: (value: number | undefined) => void
  placeholder?: string
  allowBlank?: boolean
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step="0.0001"
        value={allowBlank && onChangeOptional && value === 0 ? '' : value}
        placeholder={placeholder}
        onChange={(event) => {
          if (allowBlank && onChangeOptional) {
            onChangeOptional(event.target.value === '' ? undefined : Number(event.target.value))
            return
          }
          onChange?.(Number(event.target.value))
        }}
      />
    </label>
  )
}

function SeatBox({
  title,
  value,
  onChange,
  baggage = false,
}: {
  title: string
  value: number
  onChange: (value: number) => void
  baggage?: boolean
}) {
  return (
    <label className={`fp-seat-box ${baggage ? 'is-baggage' : ''}`}>
      <span>{title}</span>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <small>kg</small>
    </label>
  )
}

function FlightPlanDocument({
  plan,
  derived,
  routeRows,
  onHeaderChange,
  onSectionSelect,
  onRouteSegmentSelect,
  onOpenAircraftPicker,
  onRadioNavChange,
  onAddRouteRow,
  onOpenRowMenu,
}: {
  plan: FlightPlanInput
  derived: ReturnType<typeof calculateFlightPlan>
  routeRows: RouteRow[]
  onHeaderChange: (key: keyof FlightPlanInput['header'], value: string) => void
  onSectionSelect: (panel: EditorPanel) => void
  onRouteSegmentSelect: (rowIndex: number) => void
  onOpenAircraftPicker: () => void
  onRadioNavChange: (index: number, key: 'name' | 'frequency', value: string) => void
  onAddRouteRow?: () => void
  onOpenRowMenu?: (x: number, y: number, rowIndex: number) => void
}) {
  const [pressTimer, setPressTimer] = useState<number | null>(null)

  const clearPressTimer = () => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer)
      setPressTimer(null)
    }
  }

  const startLongPress = (event: ReactPointerEvent<HTMLTableRowElement>, rowIndex: number) => {
    clearPressTimer()
    const nextTimer = window.setTimeout(() => {
      onOpenRowMenu?.(event.clientX, event.clientY, rowIndex)
      setPressTimer(null)
    }, 550)
    setPressTimer(nextTimer)
  }

  return (
    <div className="fp-flight-form">
      <section className="fp-flight-form__header">
        <div className="fp-title-box">
          <div className="fp-crest" aria-hidden="true">
            <span className="fp-crest-text">LBFK</span>
            <img className="fp-crest-logo" src={printLogoSrc} alt="" />
          </div>
          <div className="fp-title-copy">
            <h2>LULEÅ-BODEN FLYGKLUBB</h2>
            <h3>DRIFTFÄRDPLAN</h3>
            <p>Signatur befälhavare</p>
          </div>
        </div>
        <div className="fp-header-meta-grid">
          <HeaderField label="Datum" className="fp-meta-date"><input type="date" value={plan.header.date} onChange={(event) => onHeaderChange('date', event.target.value)} /></HeaderField>
          <HeaderField label="Registrering" className="fp-meta-registration">
            <button type="button" className="fp-header-picker" onClick={onOpenAircraftPicker}>
              <strong>{plan.aircraftRegistration}</strong>
            </button>
          </HeaderField>
          <HeaderField label="Typ" className="fp-meta-type"><strong>{derived.aircraft.typeName}</strong></HeaderField>
          <HeaderField label="Startflygplats" className="fp-meta-departure"><input value={plan.header.departureAerodrome} onChange={(event) => onHeaderChange('departureAerodrome', event.target.value)} /></HeaderField>
          <HeaderField label="Block in" className="fp-meta-block-in"><input value={plan.header.blockIn} onChange={(event) => onHeaderChange('blockIn', event.target.value)} /></HeaderField>
          <HeaderField label="Landning" className="fp-meta-landing"><input value={plan.header.landing} onChange={(event) => onHeaderChange('landing', event.target.value)} /></HeaderField>
          <HeaderField label="Befälhavare / Status" className="fp-meta-captain"><input value={plan.header.captain} onChange={(event) => onHeaderChange('captain', event.target.value)} /></HeaderField>
          <HeaderField label="Spanare / Status" className="fp-meta-observer"><input value={plan.header.observer} onChange={(event) => onHeaderChange('observer', event.target.value)} /></HeaderField>
          <HeaderField label="NOTAM kontroll" className="fp-meta-notam"><input value={plan.header.notamStatus} onChange={(event) => onHeaderChange('notamStatus', event.target.value)} /></HeaderField>
          <HeaderField label="Landningsflygplats" className="fp-meta-destination"><input value={plan.header.destinationAerodrome} onChange={(event) => onHeaderChange('destinationAerodrome', event.target.value)} /></HeaderField>
          <HeaderField label="Block ut" className="fp-meta-block-out"><input value={plan.header.blockOut} onChange={(event) => onHeaderChange('blockOut', event.target.value)} /></HeaderField>
          <HeaderField label="Start" className="fp-meta-takeoff"><input value={plan.header.takeoff} onChange={(event) => onHeaderChange('takeoff', event.target.value)} /></HeaderField>
          <HeaderField label="Fpl status" className="fp-meta-fpl-status"><input value={plan.header.fplStatus} onChange={(event) => onHeaderChange('fplStatus', event.target.value)} /></HeaderField>
          <HeaderField label="Daglig tillsyn" className="fp-meta-daily"><input value={plan.header.dailyInspection} onChange={(event) => onHeaderChange('dailyInspection', event.target.value)} /></HeaderField>
          <HeaderField label="Väder / Metar" className="fp-meta-weather"><input value={plan.header.weatherStatus} onChange={(event) => onHeaderChange('weatherStatus', event.target.value)} /></HeaderField>
          <HeaderField label="Blocktid" className="fp-meta-block-time"><strong>{formatTimeFromMinutes(derived.totals.blockTimeMinutes)}</strong></HeaderField>
          <HeaderField label="Flygtid" className="fp-meta-flight-time"><strong>{formatTimeFromMinutes(derived.totals.flightTimeMinutes)}</strong></HeaderField>
        </div>
      </section>

      <section className="fp-route-table__wrap">
        <table className="fp-route-table">
          <thead>
            <tr>
              <th>W/v</th><th>TAS</th><th>TT</th><th>WCA</th><th>TH</th><th>var</th><th>MH</th><th>Alt/FL</th><th>STRÄCKA</th><th>VOR/NDB</th><th>GS</th><th>DIST INT</th><th>DIST ACC</th><th>TID INT</th><th>TID ACC</th><th>NOTERING</th>
            </tr>
          </thead>
          <tbody>
            {routeRows.map((row) => (
              <tr
                key={String(row.index)}
                onContextMenu={(event) => {
                  if (!onOpenRowMenu || typeof row.index !== 'number' || row.index >= plan.routeLegs.length) {
                    return
                  }
                  event.preventDefault()
                  onOpenRowMenu(event.clientX, event.clientY, row.index)
                }}
                onPointerDown={(event) => {
                  if (!onOpenRowMenu || typeof row.index !== 'number' || row.index >= plan.routeLegs.length || event.pointerType !== 'touch') {
                    return
                  }
                  startLongPress(event, row.index)
                }}
                onPointerUp={clearPressTimer}
                onPointerCancel={clearPressTimer}
                onPointerLeave={clearPressTimer}
                onPointerMove={clearPressTimer}
              >
                <td>{row.wind}</td><td>{row.tas}</td><td className="fp-highlight-cell">{row.tt}</td><td>{row.wca}</td><td>{row.th}</td><td>{row.variation}</td><td className="fp-highlight-cell">{row.mh}</td><td>{row.altitude}</td>
                <td
                  className="fp-highlight-cell fp-route-link"
                  onClick={() => {
                    if (typeof row.index === 'number' && row.index < plan.routeLegs.length) {
                      onRouteSegmentSelect(row.index)
                    }
                  }}
                >
                  {row.segment}
                </td>
                <td>{row.navRef}</td><td>{row.gs}</td><td>{row.distInt}</td><td>{row.distAcc}</td><td>{row.timeInt}</td><td>{row.timeAcc}</td><td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {onAddRouteRow && (
          <div className="fp-route-actions fp-no-print">
            <button type="button" onClick={onAddRouteRow} disabled={routeRows.length >= 13}>
              Lägg till rad
            </button>
          </div>
        )}
      </section>

      <section className="fp-bottom-grid">
        <div className="fp-subtable fp-performance-panel" onClick={() => onSectionSelect('performance')}>
          <div className="fp-subtable-title">STOL-PRESTANDA/VÄDERINFO</div>
          <div className="fp-metric-row"><span>T/O TILL 50 FOT ENL POH</span><strong>{formatNumber(derived.performance.takeoffPohM)} m</strong></div>
          <div className="fp-metric-row"><span>T/O INKL KORREKTIONER</span><strong>{formatNumber(derived.performance.takeoffCorrectedM)} m</strong></div>
          <div className="fp-metric-row fp-highlight-row"><span>TILLGÄNGLIG STARTSTRÄCKA</span><strong>{formatNumber(plan.performance.availableTakeoffDistanceM)} m</strong></div>
          <div className="fp-metric-row"><span>LDG FR 50 FOT ENL POH</span><strong>{formatNumber(derived.performance.landingPohM)} m</strong></div>
          <div className="fp-metric-row"><span>LDG INKL KORREKTIONER</span><strong>{formatNumber(derived.performance.landingCorrectedM)} m</strong></div>
          <div className="fp-metric-row fp-highlight-row"><span>TILLGÄNGLIG LAND.STRÄCKA</span><strong>{formatNumber(plan.performance.availableLandingDistanceM)} m</strong></div>
        </div>

        <div className="fp-subtable">
          <div className="fp-subtable-title">RADIO/NAV</div>
          {plan.radioNav.map((entry, index) => (
            <div className="fp-radio-row" key={index}>
              <input value={entry.name} onChange={(event) => onRadioNavChange(index, 'name', event.target.value)} />
              <input value={entry.frequency} onChange={(event) => onRadioNavChange(index, 'frequency', event.target.value)} />
            </div>
          ))}
        </div>

        <div className="fp-subtable fp-fuel-panel" onClick={() => onSectionSelect('fuel')}>
          <div className="fp-subtable-title">BRÄNSLE</div>
          <div className="fp-fuel-table">
            <div className="fp-fuel-table__header"><span></span><strong>Tid</strong><strong>Liter</strong></div>
            <div><span>Sträcka</span><span>{formatTimeFromMinutes(derived.fuel.tripTimeMinutes)}</span><span>{formatNumber(derived.fuel.tripLiters, 1)}</span></div>
            <div><span>Extra 10%</span><span>{formatTimeFromMinutes(Math.round(derived.fuel.tripTimeMinutes * 0.1))}</span><span>{formatNumber(derived.fuel.contingencyLiters, 1)}</span></div>
            <div><span>Reserv</span><span>{formatTimeFromMinutes(plan.fuel.reserveMinutes)}</span><span>{formatNumber(derived.fuel.reserveLiters, 1)}</span></div>
            <div className="fp-sum-row"><span>Summa</span><span>{formatTimeFromMinutes(derived.fuel.tripTimeMinutes + Math.round(derived.fuel.tripTimeMinutes * 0.1) + plan.fuel.reserveMinutes)}</span><span>{formatNumber(derived.fuel.totalPlannedLiters, 1)}</span></div>
            <div><span>Extra ombord</span><span></span><span>{formatNumber(plan.fuel.extraOnBoardLiters, 1)}</span></div>
            <div className="fp-sum-row"><span>TOTALT</span><span></span><span>{formatNumber(derived.fuel.totalOnBoardLiters, 1)}</span></div>
          </div>
          <div className="fp-fuel-burn-note">Förbrukning {formatNumber(derived.fuel.burnRateLph, 1)} lit/tim</div>
        </div>

        <div className="fp-subtable fp-weight-panel" onClick={() => onSectionSelect('weightBalance')}>
          <div className="fp-subtable-title">VIKT & BALANS</div>
          <div className="fp-wb-grid">
            <div className="fp-wb-header"><span></span><strong>Vikt</strong><strong>Arm</strong><strong>Moment</strong></div>
            <div><span>Tomvikt</span><span>{formatNumber(derived.aircraft.emptyWeightKg, 1)}</span><span>-</span><span>{formatNumber(derived.aircraft.emptyMomentKgMm)}</span></div>
            <div><span>Fram</span><span>{formatNumber(derived.weightBalance.frontKg, 1)}</span><span>{formatNumber(derived.aircraft.armsMm.frontLeft)}</span><span>{formatNumber(derived.weightBalance.frontKg * derived.aircraft.armsMm.frontLeft)}</span></div>
            <div><span>Bak</span><span>{formatNumber(derived.weightBalance.rearKg, 1)}</span><span>{formatNumber(derived.aircraft.armsMm.rearLeft)}</span><span>{formatNumber(derived.weightBalance.rearKg * derived.aircraft.armsMm.rearLeft)}</span></div>
            <div><span>Bagage</span><span>{formatNumber(derived.weightBalance.baggageKg, 1)}</span><span>{formatNumber(derived.aircraft.armsMm.baggage)}</span><span>{formatNumber(derived.weightBalance.baggageKg * derived.aircraft.armsMm.baggage)}</span></div>
            <div><span>Bränsle</span><span>{formatNumber(derived.weightBalance.fuelWeightKg, 1)}</span><span>{formatNumber(derived.aircraft.armsMm.fuel)}</span><span>{formatNumber(derived.weightBalance.fuelWeightKg * derived.aircraft.armsMm.fuel)}</span></div>
            <div className="fp-sum-row"><span>TOW</span><span>{formatNumber(derived.weightBalance.towKg, 1)}</span><span>{formatNumber(derived.weightBalance.armMm)}</span><span>{formatNumber(derived.weightBalance.totalMomentKgMm)}</span></div>
            <div className="fp-wb-limits"><span>MAX TOW {formatNumber(derived.aircraft.limits.maxTowKg, 1)} kg</span><span>Arm max {formatNumber(derived.aircraft.limits.maxArmMm)}</span><span>Arm min {formatNumber(derived.aircraft.limits.minArmMm)}</span></div>
          </div>
        </div>
      </section>
    </div>
  )
}

function HeaderField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`fp-header-field${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      <div>{children}</div>
    </label>
  )
}

function RoutePreview({ legs }: { legs: FlightPlanInput['routeLegs'] }) {
  const points = legs.flatMap((leg, index) => (index === 0 ? [leg.from, leg.to] : [leg.to]))
  const lats = points.map((point) => point.lat)
  const lons = points.map((point) => point.lon)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)

  const project = (lat: number, lon: number) => {
    const width = 760
    const height = 420
    const padding = 40
    const x = padding + ((lon - minLon) / Math.max(maxLon - minLon, 0.01)) * (width - padding * 2)
    const y = height - padding - ((lat - minLat) / Math.max(maxLat - minLat, 0.01)) * (height - padding * 2)
    return { x, y }
  }

  const polyline = points.map((point) => {
    const projected = project(point.lat, point.lon)
    return `${projected.x},${projected.y}`
  }).join(' ')

  return (
    <div className="fp-route-preview">
      <svg viewBox="0 0 760 420" role="img" aria-label="Ruttöversikt">
        <rect x="0" y="0" width="760" height="420" fill="#f6f3ea" />
        {Array.from({ length: 7 }, (_, index) => (
          <line key={`h-${index}`} x1="40" x2="720" y1={40 + index * 56} y2={40 + index * 56} stroke="#ddd5c4" strokeDasharray="4 6" />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <line key={`v-${index}`} y1="40" y2="380" x1={40 + index * 136} x2={40 + index * 136} stroke="#ddd5c4" strokeDasharray="4 6" />
        ))}
        <polyline fill="none" stroke="#ff35c4" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" points={polyline} />
        {points.map((point, index) => {
          const projected = project(point.lat, point.lon)
          return (
            <g key={`${point.name}-${index}`}>
              <circle cx={projected.x} cy={projected.y} r="7" fill="#ff35c4" stroke="#ffffff" strokeWidth="3" />
              <text x={projected.x + 10} y={projected.y - 12} fontSize="16" fill="#3a3228" fontWeight="600">
                {point.name}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="fp-route-legend">
        {legs.map((leg, index) => (
          <div key={`${leg.from.name}-${leg.to.name}-${index}`}>
            <strong>{leg.from.name} → {leg.to.name}</strong>
            <span>{leg.altitude} ft · {leg.windDirection}/{leg.windSpeedKt} kt</span>
          </div>
        ))}
      </div>
    </div>
  )
}
