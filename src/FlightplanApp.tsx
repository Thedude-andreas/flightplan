import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import './features/flightplan/flightplan.css'
import { aircraftProfiles, createInitialFlightPlan, DEFAULT_ROUTE_TAS_KT } from './features/flightplan/data'
import { calculateFlightPlan, formatNumber, formatTimeFromMinutes } from './features/flightplan/calculations'
import { getRoutePointLabel, legsToWaypoints, useGazetteerVersion, waypointsToLegs } from './features/flightplan/gazetteer'
import { FlightplanMapEditor, type FlightplanMapViewport } from './features/flightplan/FlightplanMapEditor'
import {
  buildSuggestedRadioNav,
  mergeRadioNavEntries,
} from './features/flightplan/radioNav'
import { fetchNotamsForAirports, type AirportNotam, type NotamSupplement } from './features/flightplan/notam'
import { isSupabaseConfigured } from './lib/supabase/client'
import {
  buildNotamMapOverlayFeatures,
  formatNotamText,
  getRelevantSupplements,
  getRouteNotamMatches,
  getSupplementSourceLabel,
  getSupplementValidityLabel,
} from './features/flightplan/notamRoute'
import { fetchLfvWeatherBriefing, fetchWeatherForAirports, getAirportsNearRoute, type AirportWeather, type LfvLhpArea } from './features/flightplan/weather'
import { formatWeatherBriefingText, getRelevantLhpAreas } from './features/flightplan/weatherRoute'
import { getRouteWeatherMatches } from './features/flightplan/weatherSigmet'
import { fetchRouteLegAloftWinds, type RouteLegAloftWind } from './features/flightplan/openMeteoAloft'
import { calculateRouteLegMagneticVariations } from './features/flightplan/magneticVariation'
import type { AircraftProfile, FlightPlanInput, RadioNavEntry } from './features/flightplan/types'

type EditorPanel = 'fuel' | 'weightBalance' | 'performance' | 'aircraft' | 'weather' | 'notam'
type WorkspaceTab = 'flightplan' | 'map' | 'print'
const aloftWindAutoFetchStorageKey = 'flightplan.aloftWindAutoFetch.v1'

type RouteRow = {
  index: number
  wind: string
  windManual: boolean
  tas: number | string
  tt: number | string
  mt: number | string
  wca: number | string
  th: number | string
  variation: number | string
  mh: number | string
  altitude: string
  segment: string
  navRef: string
  gs: number | string
  distInt: number | string
  distAcc: number | string
  timeInt: string
  timeAcc: string
  notes: string
}
type RowContextMenuState = { x: number; y: number; rowIndex: number } | null
type AltitudeDragState = {
  sourceIndex: number
  altitude: string
  hasDragged: boolean
  startX: number
  startY: number
}
type AloftWindState =
  | {
      status: 'idle'
      winds: RouteLegAloftWind[]
      error: null
      lastUpdatedAt: null
    }
  | {
      status: 'loading'
      winds: RouteLegAloftWind[]
      error: null
      lastUpdatedAt: string | null
    }
  | {
      status: 'ready'
      winds: RouteLegAloftWind[]
      error: null
      lastUpdatedAt: string
    }
  | {
      status: 'error'
      winds: RouteLegAloftWind[]
      error: string
      lastUpdatedAt: string | null
    }
type WeatherState =
  | {
      status: 'idle'
      results: AirportWeather[]
      sigmetText: string | null
      sigmetSourceUrl: string | null
      sigmetPublishedAt: string | null
      lhpAreas: LfvLhpArea[]
      error: string | null
      lastUpdatedAt: null
    }
  | {
      status: 'loading'
      results: AirportWeather[]
      sigmetText: string | null
      sigmetSourceUrl: string | null
      sigmetPublishedAt: string | null
      lhpAreas: LfvLhpArea[]
      error: string | null
      lastUpdatedAt: null
    }
  | {
      status: 'ready'
      results: AirportWeather[]
      sigmetText: string | null
      sigmetSourceUrl: string | null
      sigmetPublishedAt: string | null
      lhpAreas: LfvLhpArea[]
      error: string | null
      lastUpdatedAt: string
    }
  | {
      status: 'error'
      results: AirportWeather[]
      sigmetText: string | null
      sigmetSourceUrl: string | null
      sigmetPublishedAt: string | null
      lhpAreas: LfvLhpArea[]
      error: string
      lastUpdatedAt: null
    }
type NotamState =
  | {
      status: 'idle'
      results: AirportNotam[]
      enRouteText: string | null
      warningsText: string | null
      supplements: NotamSupplement[]
      error: string | null
      lastUpdatedAt: null
      sourceUrl: null
      supplementSourceUrl: null
      bulletinPublishedAt: null
    }
  | {
      status: 'loading'
      results: AirportNotam[]
      enRouteText: string | null
      warningsText: string | null
      supplements: NotamSupplement[]
      error: string | null
      lastUpdatedAt: null
      sourceUrl: null
      supplementSourceUrl: null
      bulletinPublishedAt: null
    }
  | {
      status: 'ready'
      results: AirportNotam[]
      enRouteText: string | null
      warningsText: string | null
      supplements: NotamSupplement[]
      error: string | null
      lastUpdatedAt: string | null
      sourceUrl: string | null
      supplementSourceUrl: string | null
      bulletinPublishedAt: string | null
    }
  | {
      status: 'error'
      results: AirportNotam[]
      enRouteText: string | null
      warningsText: string | null
      supplements: NotamSupplement[]
      error: string
      lastUpdatedAt: null
      sourceUrl: null
      supplementSourceUrl: null
      bulletinPublishedAt: null
    }

const printLogoSrc = `${import.meta.env.BASE_URL}lbfk-logo.png`
const contextMenuSize = { width: 220, height: 112, margin: 12 }
const lfvNotamSwedenUrl = 'https://www.aro.lfv.se/Links/Link/ShowFileList?path=%5Cpibsweden%5C&torlinkName=NOTAM+Sweden&type=AIS'
const lfvAroHomeUrl = 'https://www.aro.lfv.se/'
const lfvSigmetUrl = 'https://www.aro.lfv.se/Links/Link/ShowFileList?type=MET&path=%5CAREA%5CSIGMET%5C&torlinkName=SIGMET%2FARS%2FAIRMET'

function getEndpointLabel(
  point: FlightPlanInput['routeLegs'][number]['from'] | undefined,
  fallback: string,
) {
  if (!point) {
    return fallback
  }

  return getRoutePointLabel(point)
}

function clampContextMenuPosition(x: number, y: number) {
  const maxX = window.innerWidth - contextMenuSize.width - contextMenuSize.margin
  const maxY = window.innerHeight - contextMenuSize.height - contextMenuSize.margin

  return {
    x: Math.max(contextMenuSize.margin, Math.min(x, maxX)),
    y: Math.max(contextMenuSize.margin, Math.min(y, maxY)),
  }
}

function normalizeDegrees(value: number) {
  const result = value % 360
  return result < 0 ? result + 360 : result
}

function formatUtcTimestamp(value: string | null) {
  if (!value) {
    return null
  }

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatLocalTimestamp(value: string | null) {
  if (!value) {
    return null
  }

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function normalizeHeader(plan: FlightPlanInput): FlightPlanInput['header'] {
  return {
    ...plan.header,
    plannedStartTime: plan.header.plannedStartTime ?? plan.header.blockOut ?? '09:00',
  }
}

function emptyRouteRow(index: number): RouteRow {
  return {
    index,
    wind: '',
    windManual: false,
    tas: '',
    tt: '',
    mt: '',
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
  autoFetchWindEnabled: boolean,
  tasInputUnit: 'kt' | 'mph',
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

  const rows: RouteRow[] = derived.routeLegs.map((leg, index) => {
    const sourceLeg = plan.routeLegs[index]
    const manualWind = sourceLeg.manualWind
    const hasStoredWind = sourceLeg.windDirection > 0 || sourceLeg.windSpeedKt > 0
    const displayWind = manualWind
      ? `${manualWind.direction}/${manualWind.speedKt}`
      : autoFetchWindEnabled || hasStoredWind
        ? `${sourceLeg.windDirection}/${sourceLeg.windSpeedKt}`
        : ''

    return {
      index,
      wind: displayWind,
      windManual: Boolean(manualWind),
      tas: tasInputUnit === 'mph' ? Math.round(sourceLeg.tasKt / 0.8689762419) : sourceLeg.tasKt,
      tt: leg.trueTrack,
      mt: normalizeDegrees(leg.trueTrack - sourceLeg.variation),
      wca: leg.windCorrectionAngle,
      th: leg.trueHeading,
      variation: sourceLeg.variation,
      mh: leg.magneticHeading,
      altitude: sourceLeg.altitude,
      segment: leg.segmentName,
      navRef: sourceLeg.navRef,
      gs: leg.groundSpeedKt,
      distInt: leg.distanceNm,
      distAcc: leg.accumulatedDistanceNm,
      timeInt: formatTimeFromMinutes(leg.legTimeMinutes),
      timeAcc: formatTimeFromMinutes(leg.accumulatedTimeMinutes),
      notes: sourceLeg.notes,
    }
  })

  if (!targetLength || rows.length >= targetLength) {
    return rows
  }

  return rows.concat(Array.from({ length: targetLength - rows.length }, (_, index) => emptyRouteRow(rows.length + index)))
}

function cloneAircraftProfile(source: AircraftProfile): AircraftProfile {
  return {
    ...source,
    stations: source.stations.map((station) => ({ ...station })),
    fuelStation: { ...source.fuelStation },
    limits: { ...source.limits },
    performance: { ...source.performance },
  }
}

function createStationLoadsForAircraft(aircraft: AircraftProfile) {
  return aircraft.stations.map((station) => ({
    stationId: station.id,
    weightKg: station.defaultWeightKg ?? 0,
  }))
}

function mapLegacyStationWeight(
  station: AircraftProfile['stations'][number],
  legacyWeightBalance: {
    frontLeftKg?: number
    frontRightKg?: number
    rearLeftKg?: number
    rearRightKg?: number
    baggageKg?: number
  },
  seatIndex: number,
) {
  const stationName = station.name.toLowerCase()

  if (station.kind === 'baggage' || stationName.includes('bagage')) {
    return legacyWeightBalance.baggageKg ?? station.defaultWeightKg ?? 0
  }

  if (seatIndex === 0) {
    return legacyWeightBalance.frontLeftKg ?? station.defaultWeightKg ?? 0
  }

  if (seatIndex === 1) {
    return legacyWeightBalance.frontRightKg ?? station.defaultWeightKg ?? 0
  }

  if (seatIndex === 2) {
    return legacyWeightBalance.rearLeftKg ?? station.defaultWeightKg ?? 0
  }

  if (seatIndex === 3) {
    return legacyWeightBalance.rearRightKg ?? station.defaultWeightKg ?? 0
  }

  return station.defaultWeightKg ?? 0
}

function getAircraftForPlan(plan: FlightPlanInput, aircraftOptions: AircraftProfile[]) {
  return aircraftOptions.find((aircraft) => aircraft.registration === plan.aircraftRegistration) ?? aircraftOptions[0]
}

function normalizeWeightBalanceForAircraft(
  plan: FlightPlanInput,
  aircraft: AircraftProfile | undefined,
  useDefaultLoads = false,
): FlightPlanInput['weightBalance'] {
  if (!aircraft) {
    return {
      stationLoads: Array.isArray((plan.weightBalance as { stationLoads?: FlightPlanInput['weightBalance']['stationLoads'] }).stationLoads)
        ? (plan.weightBalance as { stationLoads: FlightPlanInput['weightBalance']['stationLoads'] }).stationLoads.map((load) => ({ ...load }))
        : [],
    }
  }

  if (useDefaultLoads) {
    return {
      stationLoads: createStationLoadsForAircraft(aircraft),
    }
  }

  const currentWeightBalance = plan.weightBalance as FlightPlanInput['weightBalance'] & {
    frontLeftKg?: number
    frontRightKg?: number
    rearLeftKg?: number
    rearRightKg?: number
    baggageKg?: number
  }
  const currentLoads = Array.isArray(currentWeightBalance.stationLoads)
    ? currentWeightBalance.stationLoads
    : null
  const seatStations = aircraft.stations.filter((station) => station.kind === 'seat')

  return {
    stationLoads: aircraft.stations.map((station) => {
      const existingLoad = currentLoads?.find((load) => load.stationId === station.id)
      const seatIndex = seatStations.findIndex((seat) => seat.id === station.id)

      return {
        stationId: station.id,
        weightKg: existingLoad?.weightKg ?? mapLegacyStationWeight(station, currentWeightBalance, seatIndex),
      }
    }),
  }
}

function cloneFlightPlan(plan: FlightPlanInput): FlightPlanInput {
  return {
    ...plan,
    header: normalizeHeader(plan),
    routeLegs: plan.routeLegs.map((leg) => ({
      ...leg,
      manualWind: leg.manualWind ? { ...leg.manualWind } : null,
      from: { ...leg.from },
      to: { ...leg.to },
    })),
    radioNav: plan.radioNav.map((entry) => ({ ...entry })),
    performance: { ...plan.performance },
    fuel: { ...plan.fuel },
    weightBalance: {
      stationLoads: Array.isArray(plan.weightBalance.stationLoads)
        ? plan.weightBalance.stationLoads.map((load) => ({ ...load }))
        : [],
    },
  }
}

function readStoredAloftWindAutoFetchEnabled() {
  if (typeof window === 'undefined') {
    return true
  }

  const raw = window.localStorage.getItem(aloftWindAutoFetchStorageKey)
  if (raw == null) {
    return true
  }

  return raw !== 'false'
}

const selectableAltitudesFt = Array.from({ length: 19 }, (_, index) => 500 + index * 500)

function formatAltitudeOption(altitudeFt: number) {
  return `${altitudeFt}'`
}

function formatDegreeCellValue(value: number | string) {
  if (value === '') {
    return ''
  }

  return typeof value === 'number' ? `${value}°` : value.includes('°') ? value : `${value}°`
}

function formatUnitCellValue(value: number | string, unit: string) {
  if (value === '') {
    return ''
  }

  return typeof value === 'number' ? `${value} ${unit}` : value.includes(unit) ? value : `${value} ${unit}`
}

function isPreferredAltitude(trackDegrees: number, altitudeFt: number) {
  const normalizedTrack = normalizeDegrees(trackDegrees)
  const oddSet = altitudeFt % 1000 === 500
  return normalizedTrack < 180 ? oddSet : !oddSet
}

type FlightplanAppProps = {
  initialPlan?: FlightPlanInput
  initialAircraftOptions?: AircraftProfile[]
  initialActiveTab?: WorkspaceTab
  initialMapViewport?: FlightplanMapViewport | null
  documentTitleSlot?: ReactNode
  documentToolbarSlot?: ReactNode
  mapHudSlot?: ReactNode
  mapHudStatusSlot?: ReactNode
  onPlanChange?: (plan: FlightPlanInput) => void
  onActiveTabChange?: (tab: WorkspaceTab) => void
  onMapViewportChange?: (viewport: FlightplanMapViewport) => void
}

export function FlightplanApp({
  initialPlan,
  initialAircraftOptions,
  initialActiveTab = 'flightplan',
  initialMapViewport = null,
  documentTitleSlot,
  documentToolbarSlot,
  mapHudSlot,
  mapHudStatusSlot,
  onPlanChange,
  onActiveTabChange,
  onMapViewportChange,
}: FlightplanAppProps = {}) {
  useGazetteerVersion()
  const aircraftOptions = useMemo<AircraftProfile[]>(
    () => (initialAircraftOptions ?? aircraftProfiles).map(cloneAircraftProfile),
    [initialAircraftOptions],
  )

  const normalizePlanRadioNav = (nextPlan: FlightPlanInput): FlightPlanInput => {
    const departureLabel = getEndpointLabel(nextPlan.routeLegs[0]?.from, nextPlan.header.departureAerodrome)
    const destinationLabel = getEndpointLabel(
      nextPlan.routeLegs[nextPlan.routeLegs.length - 1]?.to,
      nextPlan.header.destinationAerodrome,
    )
    const planWithSyncedEndpoints: FlightPlanInput = {
      ...nextPlan,
      header: {
        ...nextPlan.header,
        departureAerodrome: departureLabel,
        destinationAerodrome: destinationLabel,
      },
    }

    return {
      ...planWithSyncedEndpoints,
      radioNav: mergeRadioNavEntries(
        planWithSyncedEndpoints.radioNav,
        buildSuggestedRadioNav(planWithSyncedEndpoints),
      ),
    }
  }

  const normalizePlanForAircraft = (nextPlan: FlightPlanInput, useDefaultLoads = false): FlightPlanInput => {
    const aircraft = getAircraftForPlan(nextPlan, aircraftOptions)
    const syncedWeightBalance = normalizeWeightBalanceForAircraft(nextPlan, aircraft, useDefaultLoads)

    return normalizePlanRadioNav({
      ...nextPlan,
      aircraftRegistration: aircraft?.registration ?? nextPlan.aircraftRegistration,
      weightBalance: syncedWeightBalance,
    })
  }

  const [plan, setPlan] = useState<FlightPlanInput>(() =>
    normalizePlanForAircraft(cloneFlightPlan(initialPlan ?? createInitialFlightPlan())),
  )
  const [activePanel, setActivePanel] = useState<EditorPanel | null>(null)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialActiveTab)
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState>(null)
  const [focusedLegIndex, setFocusedLegIndex] = useState<number | null>(null)
  const [activeAltitudeLegIndex, setActiveAltitudeLegIndex] = useState<number | null>(null)
  const [openAltitudeMenuIndex, setOpenAltitudeMenuIndex] = useState<number | null>(null)
  const [altitudeDragState, setAltitudeDragState] = useState<AltitudeDragState | null>(null)
  const [suppressNextAltitudeMenuClick, setSuppressNextAltitudeMenuClick] = useState(false)
  const altitudeMenuRootRef = useRef<HTMLDivElement | null>(null)
  const [weatherRefreshToken, setWeatherRefreshToken] = useState(0)
  const [aloftWindAutoFetchEnabled, setAloftWindAutoFetchEnabled] = useState(readStoredAloftWindAutoFetchEnabled)
  const [aloftWindState, setAloftWindState] = useState<AloftWindState>({
    status: 'idle',
    winds: [],
    error: null,
    lastUpdatedAt: null,
  })
  const [weatherState, setWeatherState] = useState<WeatherState>({
    status: 'idle',
    results: [],
    sigmetText: null,
    sigmetSourceUrl: null,
    sigmetPublishedAt: null,
    lhpAreas: [],
    error: null,
    lastUpdatedAt: null,
  })
  const [notamRefreshToken, setNotamRefreshToken] = useState(0)
  const [notamState, setNotamState] = useState<NotamState>({
    status: 'idle',
    results: [],
    enRouteText: null,
    warningsText: null,
    supplements: [],
    error: null,
    lastUpdatedAt: null,
    sourceUrl: null,
    supplementSourceUrl: null,
    bulletinPublishedAt: null,
  })

  const routeWindRequestKey = useMemo(
    () =>
      JSON.stringify({
        date: plan.header.date,
        plannedStartTime: plan.header.plannedStartTime,
        routeLegs: plan.routeLegs.map((leg) => ({
          from: leg.from,
          to: leg.to,
          altitude: leg.altitude,
        })),
      }),
    [plan.header.date, plan.header.plannedStartTime, plan.routeLegs],
  )

  useEffect(() => {
    window.localStorage.setItem(aloftWindAutoFetchStorageKey, String(aloftWindAutoFetchEnabled))
  }, [aloftWindAutoFetchEnabled])

  useEffect(() => {
    if (!aloftWindAutoFetchEnabled) {
      setAloftWindState((current) =>
        current.lastUpdatedAt
          ? {
              status: 'ready',
              winds: current.winds,
              error: null,
              lastUpdatedAt: current.lastUpdatedAt,
            }
          : {
              status: 'idle',
              winds: current.winds,
              error: null,
              lastUpdatedAt: null,
            },
      )
      return
    }

    if (!plan.header.date || plan.routeLegs.length === 0) {
      setAloftWindState({
        status: 'idle',
        winds: [],
        error: null,
        lastUpdatedAt: null,
      })
      return
    }

    const controller = new AbortController()
    setAloftWindState((current) => ({
      status: 'loading',
      winds: current.winds,
      error: null,
      lastUpdatedAt: current.lastUpdatedAt,
    }))

    fetchRouteLegAloftWinds(plan.routeLegs, plan.header.date, plan.header.plannedStartTime, controller.signal)
      .then((winds) => {
        setPlan((current) => {
          const nextRouteLegs = current.routeLegs.map((leg, index) => {
            const fetchedWind = winds[index]
            if (!fetchedWind) {
              return leg
            }

            return {
              ...leg,
              windDirection: fetchedWind.direction,
              windSpeedKt: fetchedWind.speedKt,
              manualWind: null,
            }
          })

          const hasChanges = nextRouteLegs.some((leg, index) => {
            const currentLeg = current.routeLegs[index]
            return (
              leg.windDirection !== currentLeg?.windDirection ||
              leg.windSpeedKt !== currentLeg?.windSpeedKt ||
              leg.manualWind !== currentLeg?.manualWind
            )
          })

          if (!hasChanges) {
            return current
          }

          return normalizePlanForAircraft({
            ...current,
            routeLegs: nextRouteLegs,
          })
        })

        setAloftWindState({
          status: 'ready',
          winds,
          error: null,
          lastUpdatedAt: new Date().toISOString(),
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setAloftWindState((current) => ({
          status: 'error',
          winds: current.winds,
          error: error instanceof Error ? error.message : 'Kunde inte hämta höjdvind från Open-Meteo.',
          lastUpdatedAt: current.lastUpdatedAt,
        }))
      })

    return () => controller.abort()
  }, [aloftWindAutoFetchEnabled, routeWindRequestKey])

  const effectivePlan = useMemo<FlightPlanInput>(() => {
    const magneticVariations = calculateRouteLegMagneticVariations(
      plan.routeLegs,
      plan.header.date,
      plan.header.plannedStartTime,
    )

    return {
      ...plan,
      routeLegs: plan.routeLegs.map((leg, index) => {
        const nextLeg = magneticVariations[index]
          ? {
              ...leg,
              variation: magneticVariations[index].declination,
            }
          : leg

        if (!aloftWindAutoFetchEnabled && leg.manualWind) {
          return {
            ...nextLeg,
            windDirection: leg.manualWind.direction,
            windSpeedKt: leg.manualWind.speedKt,
          }
        }

        return nextLeg
      }),
    }
  }, [aloftWindAutoFetchEnabled, plan])

  const derived = calculateFlightPlan(effectivePlan, aircraftOptions)
  const selectedAircraft = derived.aircraft
  const tasInputUnit = derived.aircraft.tasInputUnit ?? 'kt'
  const routeRows = useMemo(
    () => createRouteRows(effectivePlan, derived, aloftWindAutoFetchEnabled, tasInputUnit),
    [aloftWindAutoFetchEnabled, effectivePlan, derived, tasInputUnit],
  )
  const printRouteRows = useMemo(
    () => createRouteRows(effectivePlan, derived, aloftWindAutoFetchEnabled, tasInputUnit, 13),
    [aloftWindAutoFetchEnabled, effectivePlan, derived, tasInputUnit],
  )
  const suggestedRadioNav = useMemo(() => buildSuggestedRadioNav(plan), [plan])
  const effectiveRadioNav = useMemo(
    () => mergeRadioNavEntries(plan.radioNav, suggestedRadioNav),
    [plan.radioNav, suggestedRadioNav],
  )
  const nearbyRouteAirports = useMemo(() => getAirportsNearRoute(plan.routeLegs), [plan.routeLegs])
  const relevantLhpAreas = useMemo(
    () => getRelevantLhpAreas(plan.routeLegs, weatherState.lhpAreas),
    [plan.routeLegs, weatherState.lhpAreas],
  )
  const routeWeatherMatches = useMemo(
    () => getRouteWeatherMatches(plan.routeLegs, weatherState.sigmetText),
    [plan.routeLegs, weatherState.sigmetText],
  )
  const routeEnRouteMatches = useMemo(
    () => getRouteNotamMatches(plan.routeLegs, notamState.enRouteText),
    [plan.routeLegs, notamState.enRouteText],
  )
  const routeWarningMatches = useMemo(
    () => getRouteNotamMatches(plan.routeLegs, notamState.warningsText),
    [plan.routeLegs, notamState.warningsText],
  )
  const relevantSupplements = useMemo(
    () =>
      getRelevantSupplements(
        plan.routeLegs,
        plan.header.date,
        notamState.supplements,
        [...routeEnRouteMatches, ...routeWarningMatches],
        nearbyRouteAirports,
      ),
    [nearbyRouteAirports, notamState.supplements, plan.header.date, plan.routeLegs, routeEnRouteMatches, routeWarningMatches],
  )

  const notamMapFeatures = useMemo(
    () =>
      notamState.status === 'ready'
        ? buildNotamMapOverlayFeatures(
            notamState.enRouteText,
            notamState.warningsText,
            notamState.supplements,
            plan.header.date,
          )
        : [],
    [
      notamState.status,
      notamState.enRouteText,
      notamState.warningsText,
      notamState.supplements,
      plan.header.date,
    ],
  )

  const notamMapNotice = useMemo(() => {
    if (!isSupabaseConfigured()) {
      return 'NOTAM och AIP SUP i kartan kräver Supabase. Sätt VITE_SUPABASE_URL och VITE_SUPABASE_ANON_KEY (edge-funktionen notam-briefing).'
    }

    if (notamState.status === 'error') {
      return notamState.error ?? 'Kunde inte hämta NOTAM-briefing.'
    }

    if (notamState.status === 'ready' && notamMapFeatures.length === 0) {
      return 'Briefing är hämtat men inga koordinater kunde tolkas (LFV använder ofta DDMMSS N / DDDMMSS E). Öppna NOTAM-panelen och kontrollera råtext.'
    }

    return null
  }, [notamMapFeatures.length, notamState.error, notamState.status])

  useEffect(() => {
    onPlanChange?.(plan)
  }, [onPlanChange, plan])

  useEffect(() => {
    onActiveTabChange?.(activeTab)
  }, [activeTab, onActiveTabChange])

  useEffect(() => {
    setActiveTab(initialActiveTab)
  }, [initialActiveTab])

  useEffect(() => {
    const shouldLoadWeather = activePanel === 'weather' || activeTab === 'map'

    if (!shouldLoadWeather) {
      return
    }

    const controller = new AbortController()
    setWeatherState(() => ({
      status: 'loading',
      results: [],
      sigmetText: null,
      sigmetSourceUrl: null,
      sigmetPublishedAt: null,
      lhpAreas: [],
      error: null,
      lastUpdatedAt: null,
    }))

    Promise.all([
      activePanel === 'weather' && nearbyRouteAirports.length > 0
        ? fetchWeatherForAirports(nearbyRouteAirports, controller.signal)
        : Promise.resolve([]),
      fetchLfvWeatherBriefing(),
    ])
      .then(([results, briefing]) => {
        setWeatherState({
          status: 'ready',
          results,
          sigmetText: briefing.sigmetText ?? null,
          sigmetSourceUrl: briefing.sigmetSourceUrl ?? null,
          sigmetPublishedAt: briefing.sigmetPublishedAt ?? null,
          lhpAreas: briefing.lhpAreas ?? [],
          error: null,
          lastUpdatedAt: briefing.fetchedAt ?? new Date().toISOString(),
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        const message = error instanceof Error ? error.message : 'Okänt fel vid hämtning av METAR/TAF.'
        setWeatherState({
          status: 'error',
          results: [],
          sigmetText: null,
          sigmetSourceUrl: null,
          sigmetPublishedAt: null,
          lhpAreas: [],
          error: message,
          lastUpdatedAt: null,
        })
      })

    return () => controller.abort()
  }, [activePanel, activeTab, nearbyRouteAirports, plan.routeLegs.length, weatherRefreshToken])

  useEffect(() => {
    if (activePanel !== 'notam' && activeTab !== 'map') {
      return
    }

    let cancelled = false
    setNotamState({
      status: 'loading',
      results: [],
      enRouteText: null,
      warningsText: null,
      supplements: [],
      error: null,
      lastUpdatedAt: null,
      sourceUrl: null,
      supplementSourceUrl: null,
      bulletinPublishedAt: null,
    })

    fetchNotamsForAirports(nearbyRouteAirports.map((airport) => airport.icao))
      .then((response) => {
        if (cancelled) {
          return
        }

        setNotamState({
          status: 'ready',
          results: response.notams,
          enRouteText: response.enRouteText ?? null,
          warningsText: response.warningsText ?? null,
          supplements: response.supplements ?? [],
          error: null,
          lastUpdatedAt: response.fetchedAt,
          sourceUrl: response.sourceUrl,
          supplementSourceUrl: response.supplementSourceUrl ?? null,
          bulletinPublishedAt: response.bulletinPublishedAt,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : 'Okänt fel vid hämtning av NOTAM.'
        setNotamState({
          status: 'error',
          results: [],
          enRouteText: null,
          warningsText: null,
          supplements: [],
          error: message,
          lastUpdatedAt: null,
          sourceUrl: null,
          supplementSourceUrl: null,
          bulletinPublishedAt: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [activePanel, activeTab, nearbyRouteAirports, notamRefreshToken])

  const updatePlan = (updater: (current: FlightPlanInput) => FlightPlanInput) => {
    setPlan((current) => normalizePlanForAircraft(updater(current)))
  }

  const updateHeader = (key: keyof FlightPlanInput['header'], value: string) => {
    updatePlan((current) => ({
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
    updatePlan((current) => ({
      ...current,
      performance: {
        ...current.performance,
        [key]: value,
      },
    }))
  }

  const updateFuel = (key: keyof FlightPlanInput['fuel'], value: string | number | undefined) => {
    updatePlan((current) => ({
      ...current,
      fuel: {
        ...current.fuel,
        [key]: value,
      },
    }))
  }

  const updateWeightBalance = (stationId: string, value: number) => {
    updatePlan((current) => ({
      ...current,
      weightBalance: {
        ...current.weightBalance,
        stationLoads: current.weightBalance.stationLoads.map((load) =>
          load.stationId === stationId ? { ...load, weightKg: value } : load,
        ),
      },
    }))
  }

  const updateRouteLeg = (
    index: number,
    updater: (leg: FlightPlanInput['routeLegs'][number]) => FlightPlanInput['routeLegs'][number],
  ) => {
    updatePlan((current) => ({
      ...current,
      routeLegs: current.routeLegs.map((leg, legIndex) => (legIndex === index ? updater(leg) : leg)),
    }))
  }

  const updateManualWind = (index: number, value: string) => {
    if (aloftWindAutoFetchEnabled) {
      return false
    }

    const normalized = value.trim()
    if (!normalized) {
      updateRouteLeg(index, (leg) => ({ ...leg, manualWind: null }))
      return true
    }

    const match = normalized.match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/)
    if (!match) {
      return false
    }

    updateRouteLeg(index, (leg) => ({
      ...leg,
      manualWind: {
        direction: normalizeDegrees(Number(match[1])),
        speedKt: Number(match[2]),
      },
    }))
    return true
  }

  const updateAltitudeForRouteLeg = (index: number, altitude: string) => {
    updateRouteLeg(index, (leg) => ({
      ...leg,
      altitude,
    }))
  }

  const updateTasForRouteLeg = (index: number, value: string) => {
    const normalized = value.trim()
    const parsed = Number(normalized)
    if (!normalized || !Number.isFinite(parsed) || parsed <= 0) {
      return false
    }

    updateRouteLeg(index, (leg) => ({
      ...leg,
      tasKt: Math.round(tasInputUnit === 'mph' ? parsed * 0.8689762419 : parsed),
    }))
    return true
  }

  const applyAltitudeToRange = (sourceIndex: number, targetIndex: number, altitude: string) => {
    const start = Math.min(sourceIndex, targetIndex)
    const end = Math.max(sourceIndex, targetIndex)
    updatePlan((current) => ({
      ...current,
      routeLegs: current.routeLegs.map((leg, index) =>
        index >= start && index <= end ? { ...leg, altitude } : leg,
      ),
    }))
  }

  const beginAltitudeDrag = (rowIndex: number, clientX: number, clientY: number) => {
    const altitude = plan.routeLegs[rowIndex]?.altitude
    if (!altitude) {
      return
    }

    setActiveAltitudeLegIndex(rowIndex)
    setAltitudeDragState({
      sourceIndex: rowIndex,
      altitude,
      hasDragged: false,
      startX: clientX,
      startY: clientY,
    })
    setOpenAltitudeMenuIndex(null)
  }

  const extendAltitudeDrag = (rowIndex: number, buttons: number, clientX: number, clientY: number) => {
    if (!altitudeDragState || buttons !== 1) {
      return
    }

    const movedEnough =
      Math.abs(clientX - altitudeDragState.startX) > 6 ||
      Math.abs(clientY - altitudeDragState.startY) > 6 ||
      rowIndex !== altitudeDragState.sourceIndex

    if (!movedEnough) {
      return
    }

    if (rowIndex === altitudeDragState.sourceIndex && altitudeDragState.hasDragged) {
      return
    }

    applyAltitudeToRange(altitudeDragState.sourceIndex, rowIndex, altitudeDragState.altitude)
    setActiveAltitudeLegIndex(rowIndex)
    setAltitudeDragState((current) =>
      current
        ? {
            ...current,
            hasDragged: current.hasDragged || rowIndex !== current.sourceIndex,
          }
        : current,
    )
  }

  const endAltitudeDrag = () => {
    setAltitudeDragState((current) => {
      if (!current) {
        return null
      }

      if (current.hasDragged) {
        setSuppressNextAltitudeMenuClick(true)
      }

      return null
    })
  }

  const handleAltitudeMenuOpenChange = (rowIndex: number | null) => {
    if (suppressNextAltitudeMenuClick) {
      setSuppressNextAltitudeMenuClick(false)
      return
    }

    setOpenAltitudeMenuIndex(rowIndex)
  }

  useEffect(() => {
    if (!altitudeDragState) {
      return
    }

    const handlePointerUp = () => {
      endAltitudeDrag()
    }

    window.addEventListener('pointerup', handlePointerUp)
    return () => window.removeEventListener('pointerup', handlePointerUp)
  }, [altitudeDragState])

  useEffect(() => {
    if (openAltitudeMenuIndex == null) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (altitudeMenuRootRef.current?.contains(target)) {
        return
      }

      setOpenAltitudeMenuIndex(null)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [openAltitudeMenuIndex])

  const replaceRouteLegs = (routeLegs: FlightPlanInput['routeLegs']) => {
    updatePlan((current) => ({
      ...current,
      routeLegs: routeLegs.map((leg, index) => {
        if (aloftWindAutoFetchEnabled || index < current.routeLegs.length) {
          return leg
        }

        return {
          ...leg,
          windDirection: 0,
          windSpeedKt: 0,
          manualWind: null,
        }
      }),
    }))
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
    updatePlan((current) => ({
      ...current,
      routeLegs: waypointsToLegs(nextWaypoints, current.routeLegs, DEFAULT_ROUTE_TAS_KT),
    }))
  }

  const updateRadioNav = (index: number, key: 'name' | 'frequency', value: string) => {
    updatePlan((current) => ({
      ...current,
      radioNav: Array.from({ length: Math.max(current.radioNav.length, index + 1) }, (_, entryIndex) => {
        const entry = current.radioNav[entryIndex] ?? { name: '', frequency: '' }
        return entryIndex === index ? { ...entry, [key]: value } : entry
      }),
    }))
  }

  const weatherStatusLabel =
    nearbyRouteAirports.length > 0
      ? `LFV routeväder väderbriefing + ${nearbyRouteAirports.length} flygplatser`
      : 'LFV routeväder väderbriefing'
  const notamStatusLabel =
    nearbyRouteAirports.length > 0
      ? `NOTAM-briefing + ${nearbyRouteAirports.length} flygplatser`
      : 'NOTAM-briefing'

  return (
    <div className={`flightplan-page ${activeTab === 'map' ? 'is-map-view' : ''}`}>
      <header className="fp-page-header fp-no-print">
        <div>
          <p className="fp-eyebrow">VFRplan.se · allmänflyg · Sverige</p>
          <h1>VFRplan.se</h1>
          <p className="fp-lede">
            Fristående färdplansverktyg med svensk LFV/AIP-datapipeline, karteditor och utskriftsanpassad driftfärdplan.
          </p>
        </div>
      </header>

      <main className="fp-workspace" onClick={() => setRowContextMenu(null)}>
        {documentToolbarSlot && activeTab !== 'map' ? <div className="fp-page-toolbar fp-no-print">{documentToolbarSlot}</div> : null}

        {activeTab === 'flightplan' && (
          <div className="fp-tab-panel">
            <section className="fp-document-sheet">
              <FlightPlanDocument
                plan={plan}
                derived={derived}
                routeRows={routeRows}
                tasInputUnit={tasInputUnit}
                radioNavEntries={effectiveRadioNav}
                titleSlot={documentTitleSlot}
                onHeaderChange={updateHeader}
                weatherStatusLabel={weatherStatusLabel}
                aloftWindStatus={aloftWindState}
                aloftWindAutoFetchEnabled={aloftWindAutoFetchEnabled}
                onAloftWindAutoFetchChange={setAloftWindAutoFetchEnabled}
                onOpenWeatherPanel={() => {
                  setActivePanel('weather')
                  setWeatherRefreshToken((current) => current + 1)
                }}
                notamStatusLabel={notamStatusLabel}
                onOpenNotamPanel={() => {
                  setActivePanel('notam')
                  setNotamRefreshToken((current) => current + 1)
                }}
                onSectionSelect={setActivePanel}
                onRouteSegmentSelect={(rowIndex) => {
                  setFocusedLegIndex(rowIndex)
                  setActiveTab('map')
                }}
                onOpenAircraftPicker={() => setActivePanel('aircraft')}
                onRadioNavChange={updateRadioNav}
                onManualWindChange={updateManualWind}
                onTasChange={updateTasForRouteLeg}
                onAltitudeChange={updateAltitudeForRouteLeg}
                activeAltitudeLegIndex={activeAltitudeLegIndex}
                onAltitudeSelect={setActiveAltitudeLegIndex}
                openAltitudeMenuIndex={openAltitudeMenuIndex}
                onAltitudeMenuOpenChange={handleAltitudeMenuOpenChange}
                onAltitudeDragStart={beginAltitudeDrag}
                onAltitudeDragEnter={extendAltitudeDrag}
                onAltitudeDragEnd={endAltitudeDrag}
                altitudeMenuRootRef={altitudeMenuRootRef}
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
                aloftWindAutoFetchEnabled={aloftWindAutoFetchEnabled}
                aloftWinds={aloftWindState.winds}
                aloftWindStatus={aloftWindState.status}
                sigmetText={weatherState.sigmetText}
                notamMapFeatures={notamMapFeatures}
                notamMapNotice={notamMapNotice}
                notamMapStatus={notamState.status}
                hudSlot={mapHudSlot}
                hudStatusSlot={mapHudStatusSlot}
                onRouteLegsChange={replaceRouteLegs}
                focusedLegIndex={focusedLegIndex}
                initialViewport={initialMapViewport}
                onViewportChange={onMapViewportChange}
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
                tasInputUnit={tasInputUnit}
                radioNavEntries={effectiveRadioNav}
                onHeaderChange={updateHeader}
                weatherStatusLabel={weatherStatusLabel}
                aloftWindStatus={aloftWindState}
                aloftWindAutoFetchEnabled={aloftWindAutoFetchEnabled}
                onAloftWindAutoFetchChange={setAloftWindAutoFetchEnabled}
                onOpenWeatherPanel={() => {
                  setActivePanel('weather')
                  setWeatherRefreshToken((current) => current + 1)
                }}
                notamStatusLabel={notamStatusLabel}
                onOpenNotamPanel={() => {
                  setActivePanel('notam')
                  setNotamRefreshToken((current) => current + 1)
                }}
                onSectionSelect={setActivePanel}
                onRouteSegmentSelect={(rowIndex) => {
                  setFocusedLegIndex(rowIndex)
                  setActiveTab('map')
                }}
                onOpenAircraftPicker={() => setActivePanel('aircraft')}
                onRadioNavChange={updateRadioNav}
                onManualWindChange={updateManualWind}
                onTasChange={updateTasForRouteLeg}
                onAltitudeChange={updateAltitudeForRouteLeg}
                activeAltitudeLegIndex={activeAltitudeLegIndex}
                onAltitudeSelect={setActiveAltitudeLegIndex}
                openAltitudeMenuIndex={openAltitudeMenuIndex}
                onAltitudeMenuOpenChange={handleAltitudeMenuOpenChange}
                onAltitudeDragStart={beginAltitudeDrag}
                onAltitudeDragEnter={extendAltitudeDrag}
                onAltitudeDragEnd={endAltitudeDrag}
                altitudeMenuRootRef={altitudeMenuRootRef}
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
              <RoutePreview legs={effectivePlan.routeLegs} />
            </section>
          </div>
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
                          setPlan((current) => normalizePlanForAircraft({
                            ...current,
                            aircraftRegistration: aircraft.registration,
                          }, true))
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
                  {selectedAircraft.stations.map((station) => {
                    const stationLoad = plan.weightBalance.stationLoads.find((load) => load.stationId === station.id)
                    return (
                      <SeatBox
                        key={station.id}
                        title={station.name}
                        value={stationLoad?.weightKg ?? station.defaultWeightKg ?? 0}
                        onChange={(value) => updateWeightBalance(station.id, value)}
                        baggage={station.kind === 'baggage'}
                      />
                    )
                  })}
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

            {activePanel === 'weather' && (
              <section className="fp-panel-card fp-overlay-card">
                <div className="fp-panel-header">
                  <div>
                    <p className="fp-panel-eyebrow">METAR / TAF / LFV</p>
                    <h2>Väderbriefing för färdlinjen</h2>
                  </div>
                  <div className="fp-overlay-actions">
                    <button type="button" onClick={() => setWeatherRefreshToken((current) => current + 1)}>
                      Uppdatera
                    </button>
                    <button type="button" onClick={() => setActivePanel(null)}>
                      Stäng
                    </button>
                  </div>
                </div>
                <div className="fp-weather-summary">
                  <div><span>Träffar</span><strong>{nearbyRouteAirports.length}</strong></div>
                  <div><span>Status</span><strong>{weatherState.status === 'loading' ? 'Hämtar' : weatherState.status === 'error' ? 'Fel' : 'Klar'}</strong></div>
                  <div><span>Senast uppdaterad</span><strong>{formatUtcTimestamp(weatherState.lastUpdatedAt) ?? 'Ej hämtad'}</strong></div>
                </div>
                {weatherState.status === 'error' && (
                  <p className="fp-weather-empty-state">
                    Kunde inte hämta väderbriefing: {weatherState.error}
                  </p>
                )}
                {weatherState.status !== 'error' && plan.routeLegs.length === 0 && (
                  <p className="fp-weather-empty-state">
                    Lägg först in en färdlinje för att hämta routeväder, höjdvindar och flygplatsväder.
                  </p>
                )}
                {weatherState.status !== 'error' && plan.routeLegs.length > 0 && (
                  <div className="fp-weather-list">
                    <article className="fp-weather-card">
                      <div className="fp-weather-card__header">
                        <div>
                          <h3>LFV Routeväder</h3>
                          <p>SIGMET/ARS/AIRMET och LHP längs färdlinjen</p>
                        </div>
                      </div>
                      <div className="fp-weather-report-grid fp-weather-report-grid--single">
                        <section>
                          <span className="fp-weather-report-label">SIGMET / ARS / AIRMET</span>
                          <p className="fp-weather-report-time">
                            {formatUtcTimestamp(weatherState.sigmetPublishedAt)
                              ? `Publicerad ${formatUtcTimestamp(weatherState.sigmetPublishedAt)}Z`
                              : 'Senaste bulletin från LFV'}
                          </p>
                          {routeWeatherMatches.length > 0 ? (
                            <div className="fp-weather-level-list">
                              {routeWeatherMatches.map((match) => (
                                <div key={match.id} className="fp-weather-level-item">
                                  <strong>{match.firCodes[0] ?? 'SIGMET'}</strong>
                                  <p>{match.matchSummary}</p>
                                  <pre>{formatWeatherBriefingText(match.rawText) ?? match.rawText}</pre>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <pre>Ingen route-relevant SIGMET / ARS / AIRMET hittades.</pre>
                          )}
                          {weatherState.sigmetSourceUrl ?? lfvSigmetUrl ? (
                            <div className="fp-weather-links">
                              <a href={weatherState.sigmetSourceUrl ?? lfvSigmetUrl} target="_blank" rel="noreferrer">
                                Öppna LFV SIGMET/ARS/AIRMET
                              </a>
                            </div>
                          ) : null}
                        </section>
                      </div>
                    </article>

                    {relevantLhpAreas.length > 0 ? (
                      relevantLhpAreas.map(({ area, matchedLevels }) => (
                        <article key={area.id} className="fp-weather-card">
                          <div className="fp-weather-card__header">
                            <div>
                              <h3>{area.title}</h3>
                              <p>LFV LHP för route-ben i {area.id.toUpperCase()}</p>
                            </div>
                          </div>
                          <div className="fp-weather-report-grid">
                            <section>
                              <span className="fp-weather-report-label">Översikt</span>
                              <pre>{formatWeatherBriefingText(area.overviewText) ?? 'Ingen LHP-översikt tillgänglig.'}</pre>
                            </section>
                            <section>
                              <span className="fp-weather-report-label">Höjdvind matchad mot Alt</span>
                              <div className="fp-weather-level-list">
                                {matchedLevels.map(({ level, legLabels, altitudeLabels }) => (
                                  <div key={`${area.id}-${level.label}`} className="fp-weather-level-item">
                                    <strong>{level.label}</strong>
                                    <p>{legLabels.join(', ')}</p>
                                    <p>Matchad mot {altitudeLabels.join(', ')}</p>
                                    <pre>{formatWeatherBriefingText(level.rawText) ?? level.rawText}</pre>
                                  </div>
                                ))}
                              </div>
                              <div className="fp-weather-links">
                                <a href={area.sourceUrl} target="_blank" rel="noreferrer">
                                  Öppna {area.title}
                                </a>
                              </div>
                            </section>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="fp-weather-empty-state">
                        Ingen relevant LHP-område matchades mot färdlinjen.
                      </p>
                    )}

                    {nearbyRouteAirports.length === 0 && (
                      <p className="fp-weather-empty-state">
                        Rutten passerar inga registrerade svenska flygplatser inom 50 NM, men LFV-routevädret ovan är fortfarande tillgängligt.
                      </p>
                    )}

                    {weatherState.results.map((entry) => (
                      <article key={entry.airport.icao} className="fp-weather-card">
                        <div className="fp-weather-card__header">
                          <div>
                            <h3>{entry.airport.icao}</h3>
                            <p>{entry.airport.name}</p>
                          </div>
                          <strong>{formatNumber(entry.airport.distanceNm, 1)} NM</strong>
                        </div>
                        <div className="fp-weather-report-grid">
                          <section>
                            <span className="fp-weather-report-label">METAR</span>
                            <p className="fp-weather-report-time">
                              {formatUtcTimestamp(entry.metarObservedAt) ? `Observerad ${formatUtcTimestamp(entry.metarObservedAt)}Z` : 'Ingen METAR tillgänglig'}
                            </p>
                            <pre>{entry.metarRawText ?? 'Ingen METAR tillgänglig'}</pre>
                          </section>
                          <section>
                            <span className="fp-weather-report-label">TAF</span>
                            <p className="fp-weather-report-time">
                              {formatUtcTimestamp(entry.tafIssuedAt) ? `Utfärdad ${formatUtcTimestamp(entry.tafIssuedAt)}Z` : 'Ingen TAF tillgänglig'}
                            </p>
                            <pre>{entry.tafRawText ?? 'Ingen TAF tillgänglig'}</pre>
                          </section>
                        </div>
                      </article>
                    ))}
                    {weatherState.status === 'loading' && (
                      <p className="fp-weather-empty-state">Hämtar LFV-routeväder och väderrapporter för {nearbyRouteAirports.length} flygplatser...</p>
                    )}
                  </div>
                )}
              </section>
            )}

            {activePanel === 'notam' && (
              <section className="fp-panel-card fp-overlay-card">
                <div className="fp-panel-header">
                  <div>
                    <p className="fp-panel-eyebrow">NOTAM</p>
                    <h2>Route-NOTAM och varningar nära färdlinjen</h2>
                  </div>
                  <div className="fp-overlay-actions">
                    <button type="button" onClick={() => setNotamRefreshToken((current) => current + 1)}>
                      Uppdatera
                    </button>
                    <button type="button" onClick={() => setActivePanel(null)}>
                      Stäng
                    </button>
                  </div>
                </div>
                <div className="fp-weather-summary">
                  <div><span>Flygplatser</span><strong>{nearbyRouteAirports.length}</strong></div>
                  <div><span>En-route träffar</span><strong>{routeEnRouteMatches.length}</strong></div>
                  <div><span>NAV warnings</span><strong>{routeWarningMatches.length}</strong></div>
                </div>
                <div className="fp-weather-summary">
                  <div><span>AIP SUP</span><strong>{relevantSupplements.length}</strong></div>
                  <div><span>Källa</span><strong>LFV AROWeb</strong></div>
                  <div><span>Status</span><strong>{notamState.status === 'loading' ? 'Hämtar' : notamState.status === 'error' ? 'Fel' : 'Klar'}</strong></div>
                </div>
                <div className="fp-weather-summary">
                  <div><span>Cache hämtad</span><strong>{formatUtcTimestamp(notamState.lastUpdatedAt) ?? 'Ej hämtad'}</strong></div>
                  <div><span>Bulletin publicerad</span><strong>{formatUtcTimestamp(notamState.bulletinPublishedAt) ?? 'Okänd'}</strong></div>
                  <div><span>TTL</span><strong>30 min vid behov</strong></div>
                </div>
                <div className="fp-notam-actions">
                  <a href={notamState.sourceUrl ?? lfvNotamSwedenUrl} target="_blank" rel="noreferrer">
                    Öppna LFV NOTAM Sweden
                  </a>
                  <a href={lfvAroHomeUrl} target="_blank" rel="noreferrer">
                    Öppna LFV AROWeb
                  </a>
                  {notamState.supplementSourceUrl ? (
                    <a href={notamState.supplementSourceUrl} target="_blank" rel="noreferrer">
                      Öppna LFV eAIP Cover Page
                    </a>
                  ) : null}
                </div>
                {notamState.status === 'error' && (
                  <p className="fp-weather-empty-state">
                    Kunde inte hämta NOTAM: {notamState.error}
                  </p>
                )}
                {notamState.status !== 'error' ? (
                  <div className="fp-weather-list">
                    <article className="fp-weather-card">
                      <div className="fp-weather-card__header">
                        <div>
                          <h3>Aerodrome NOTAM</h3>
                          <p>Flygplatser inom 50 NM från färdlinjen</p>
                        </div>
                        <strong>{nearbyRouteAirports.length}</strong>
                      </div>
                      {nearbyRouteAirports.length === 0 ? (
                        <p className="fp-weather-empty-state">Rutten passerar inga registrerade svenska flygplatser inom 50 NM.</p>
                      ) : (
                        <div className="fp-weather-list fp-weather-list--embedded">
                          {nearbyRouteAirports.map((airport) => {
                            const entry = notamState.results.find((result) => result.icao === airport.icao)
                            return (
                              <article key={airport.icao} className="fp-weather-card fp-weather-card--nested">
                                <div className="fp-weather-card__header">
                                  <div>
                                    <h3>{airport.icao}</h3>
                                    <p>{entry?.airportName ?? airport.name}</p>
                                  </div>
                                  <strong>{formatNumber(airport.distanceNm, 1)} NM</strong>
                                </div>
                                <section className="fp-weather-report-grid fp-weather-report-grid--single">
                                  <section>
                                    <span className="fp-weather-report-label">NOTAM</span>
                                    <p className="fp-weather-report-time">
                                      {notamState.status === 'loading'
                                        ? 'Läser LFV-briefing...'
                                        : entry?.hasNotams
                                          ? 'Aktiva NOTAM i aktuell LFV-briefing'
                                          : 'Inga NOTAM i aktuell LFV-briefing'}
                                    </p>
                                    <pre>{entry?.rawText ? formatNotamText(entry.rawText) : (notamState.status === 'loading' ? 'Hämtar NOTAM...' : 'Ingen NOTAM tillgänglig')}</pre>
                                  </section>
                                </section>
                              </article>
                            )
                          })}
                        </div>
                      )}
                    </article>

                    <article className="fp-weather-card">
                      <div className="fp-weather-card__header">
                        <div>
                          <h3>En-route NOTAM</h3>
                          <p>PSN-koordinater, områden och navaids nära rutten</p>
                        </div>
                        <strong>{routeEnRouteMatches.length}</strong>
                      </div>
                      {routeEnRouteMatches.length === 0 ? (
                        <p className="fp-weather-empty-state">
                          {notamState.status === 'loading'
                            ? 'Analyserar en-route NOTAM...'
                            : 'Inga route-relevanta en-route NOTAM hittades via koordinater eller navaid-matchning.'}
                        </p>
                      ) : (
                        <div className="fp-weather-list fp-weather-list--embedded">
                          {routeEnRouteMatches.map((entry) => (
                            <article key={entry.id} className="fp-weather-card fp-weather-card--nested">
                              <div className="fp-weather-card__header">
                                <div>
                                  <h3>{entry.title}</h3>
                                  <p>{entry.matchSummary}</p>
                                </div>
                                <strong>{formatNumber(entry.distanceNm, 1)} NM</strong>
                              </div>
                              <section className="fp-weather-report-grid fp-weather-report-grid--single">
                                <section>
                                  <span className="fp-weather-report-label">EN-ROUTE</span>
                                  <pre>{formatNotamText(entry.rawText)}</pre>
                                </section>
                              </section>
                            </article>
                          ))}
                        </div>
                      )}
                    </article>

                    <article className="fp-weather-card">
                      <div className="fp-weather-card__header">
                        <div>
                          <h3>NAV Warnings</h3>
                          <p>Temporära restriktionsområden och varningar nära rutten</p>
                        </div>
                        <strong>{routeWarningMatches.length}</strong>
                      </div>
                      {routeWarningMatches.length === 0 ? (
                        <p className="fp-weather-empty-state">
                          {notamState.status === 'loading'
                            ? 'Analyserar NAV warnings...'
                            : 'Inga route-relevanta NAV warnings hittades via koordinater eller navaid-matchning.'}
                        </p>
                      ) : (
                        <div className="fp-weather-list fp-weather-list--embedded">
                          {routeWarningMatches.map((entry) => (
                            <article key={entry.id} className="fp-weather-card fp-weather-card--nested">
                              <div className="fp-weather-card__header">
                                <div>
                                  <h3>{entry.title}</h3>
                                  <p>{entry.matchSummary}</p>
                                </div>
                                <strong>{formatNumber(entry.distanceNm, 1)} NM</strong>
                              </div>
                              <section className="fp-weather-report-grid fp-weather-report-grid--single">
                                <section>
                                  <span className="fp-weather-report-label">NAV WARNING</span>
                                  <pre>{formatNotamText(entry.rawText)}</pre>
                                </section>
                              </section>
                            </article>
                          ))}
                        </div>
                      )}
                    </article>

                    <article className="fp-weather-card">
                      <div className="fp-weather-card__header">
                        <div>
                          <h3>AIP SUP</h3>
                          <p>Giltiga på {plan.header.date || 'flygdatum'} och inom 50 NM från färdlinjen</p>
                        </div>
                        <strong>{relevantSupplements.length}</strong>
                      </div>
                      {relevantSupplements.length === 0 ? (
                        <p className="fp-weather-empty-state">
                          {notamState.status === 'loading'
                            ? 'Läser giltiga LFV eSUP...'
                            : 'Ingen giltig AIP SUP inom 50 NM matchades mot flygdatum och färdlinje.'}
                        </p>
                      ) : (
                        <div className="fp-notam-supplements">
                          {relevantSupplements.map((supplement) => (
                            <article key={`${supplement.source}-${supplement.id}`} className="fp-notam-supplement-card">
                              <div>
                                <span className="fp-weather-report-label">AIP SUP {supplement.id}</span>
                                <h3>{supplement.title}</h3>
                                <p>{supplement.relevance}</p>
                                <p>
                                  {getSupplementValidityLabel(supplement)}
                                  {supplement.distanceNm !== null ? ` · ${formatNumber(supplement.distanceNm, 1)} NM från rutten` : ''}
                                </p>
                              </div>
                              <div className="fp-notam-supplement-meta">
                                {supplement.url ? (
                                  <a href={supplement.url} target="_blank" rel="noreferrer">
                                    Öppna {getSupplementSourceLabel(supplement)}
                                  </a>
                                ) : (
                                  <small>{getSupplementSourceLabel(supplement)}</small>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </article>

                    {notamState.status === 'loading' && (
                      <p className="fp-weather-empty-state">Hämtar och läser LFV NOTAM-briefing...</p>
                    )}
                  </div>
                ) : null}
              </section>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function WindCellInput({
  value,
  isManual,
  disabled = false,
  onCommit,
}: {
  value: string
  isManual: boolean
  disabled?: boolean
  onCommit: (value: string) => boolean
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    const success = onCommit(draft)
    if (!success) {
      setDraft(value)
    }
  }

  return (
    <input
      className={isManual ? 'fp-inline-wind-input is-manual' : 'fp-inline-wind-input'}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
          event.currentTarget.blur()
        }

        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
      aria-label="Vind"
    />
  )
}

function TasCellInput({
  value,
  unit,
  onCommit,
}: {
  value: number | string
  unit: 'kt' | 'mph'
  onCommit: (value: string) => boolean
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const success = onCommit(draft)
    if (!success) {
      setDraft(String(value))
    }
  }

  return (
    <span className={unit === 'mph' ? 'fp-inline-unit-field is-imperial' : 'fp-inline-unit-field'}>
      <input
        className="fp-inline-tas-input"
        value={draft}
        size={Math.max(String(draft || value || '').length, 2)}
        inputMode="numeric"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
            event.currentTarget.blur()
          }

          if (event.key === 'Escape') {
            setDraft(String(value))
            event.currentTarget.blur()
          }
        }}
        aria-label="TAS"
      />
      <span className="fp-inline-unit-label">{unit}</span>
    </span>
  )
}

function AltitudeCellSelect({
  rowIndex,
  rootRef,
  value,
  trueTrack,
  variation,
  isActive,
  isOpen,
  onFocus,
  onOpenChange,
  onChange,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: {
  rowIndex: number
  rootRef: { current: HTMLDivElement | null }
  value: string
  trueTrack: number
  variation: number
  isActive: boolean
  isOpen: boolean
  onFocus: () => void
  onOpenChange: (isOpen: boolean) => void
  onChange: (value: string) => void
  onDragStart: (rowIndex: number, clientX: number, clientY: number) => void
  onDragEnter: (rowIndex: number, buttons: number, clientX: number, clientY: number) => void
  onDragEnd: () => void
}) {
  const preferredTrack = normalizeDegrees(trueTrack - variation)
  const hasCustomValue = value !== '' && !selectableAltitudesFt.some((altitudeFt) => formatAltitudeOption(altitudeFt) === value)
  const showMenu = isOpen && isActive

  return (
    <div
      ref={(node) => {
        if (showMenu) {
          rootRef.current = node
        } else if (rootRef.current === node) {
          rootRef.current = null
        }
      }}
      className={isActive ? 'fp-inline-altitude-dropdown is-active' : 'fp-inline-altitude-dropdown'}
    >
      <button
        type="button"
        className="fp-inline-altitude-select"
        onPointerDown={(event) => onDragStart(rowIndex, event.clientX, event.clientY)}
        onPointerEnter={(event) => onDragEnter(rowIndex, event.buttons, event.clientX, event.clientY)}
        onPointerUp={onDragEnd}
        onClick={() => {
          onFocus()
          onOpenChange(!showMenu)
        }}
        aria-haspopup="listbox"
        aria-expanded={showMenu}
      >
        {value}
      </button>
      {showMenu && (
        <div className="fp-inline-altitude-menu" role="listbox">
          {hasCustomValue ? (
            <button
              type="button"
              className="fp-inline-altitude-option"
              onClick={() => {
                onFocus()
                onChange(value)
                onOpenChange(false)
              }}
            >
              <span>{value}</span>
            </button>
          ) : null}
          {selectableAltitudesFt.map((altitudeFt) => {
            const label = formatAltitudeOption(altitudeFt)
            const preferred = isPreferredAltitude(preferredTrack, altitudeFt)
            return (
              <button
                key={altitudeFt}
                type="button"
                className={preferred ? 'fp-inline-altitude-option' : 'fp-inline-altitude-option is-discouraged'}
                onClick={() => {
                  onFocus()
                  onChange(label)
                  onOpenChange(false)
                }}
              >
                <span>
                  {label}
                  {!preferred ? ' · Ej enligt halvcirkel' : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
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
  tasInputUnit,
  radioNavEntries,
  titleSlot,
  onHeaderChange,
  weatherStatusLabel,
  aloftWindStatus,
  aloftWindAutoFetchEnabled,
  onAloftWindAutoFetchChange,
  onOpenWeatherPanel,
  notamStatusLabel,
  onOpenNotamPanel,
  onSectionSelect,
  onRouteSegmentSelect,
  onOpenAircraftPicker,
  onRadioNavChange,
  onManualWindChange,
  onTasChange,
  onAltitudeChange,
  activeAltitudeLegIndex,
  onAltitudeSelect,
  openAltitudeMenuIndex,
  onAltitudeMenuOpenChange,
  onAltitudeDragStart,
  onAltitudeDragEnter,
  onAltitudeDragEnd,
  altitudeMenuRootRef,
  onOpenRowMenu,
}: {
  plan: FlightPlanInput
  derived: ReturnType<typeof calculateFlightPlan>
  routeRows: RouteRow[]
  tasInputUnit: 'kt' | 'mph'
  radioNavEntries: RadioNavEntry[]
  titleSlot?: ReactNode
  onHeaderChange: (key: keyof FlightPlanInput['header'], value: string) => void
  weatherStatusLabel: string
  aloftWindStatus: AloftWindState
  aloftWindAutoFetchEnabled: boolean
  onAloftWindAutoFetchChange: (enabled: boolean) => void
  onOpenWeatherPanel: () => void
  notamStatusLabel: string
  onOpenNotamPanel: () => void
  onSectionSelect: (panel: EditorPanel) => void
  onRouteSegmentSelect: (rowIndex: number) => void
  onOpenAircraftPicker: () => void
  onRadioNavChange: (index: number, key: 'name' | 'frequency', value: string) => void
  onManualWindChange: (rowIndex: number, value: string) => boolean
  onTasChange: (rowIndex: number, value: string) => boolean
  onAltitudeChange: (rowIndex: number, altitude: string) => void
  activeAltitudeLegIndex: number | null
  onAltitudeSelect: (rowIndex: number) => void
  openAltitudeMenuIndex: number | null
  onAltitudeMenuOpenChange: (rowIndex: number | null) => void
  onAltitudeDragStart: (rowIndex: number, clientX: number, clientY: number) => void
  onAltitudeDragEnter: (rowIndex: number, buttons: number, clientX: number, clientY: number) => void
  onAltitudeDragEnd: () => void
  altitudeMenuRootRef: { current: HTMLDivElement | null }
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
            <span className="fp-crest-text">VFR</span>
            <img className="fp-crest-logo" src={printLogoSrc} alt="" />
          </div>
          <div className="fp-title-copy">
            <h2>VFRPLAN.SE</h2>
            <h3>DRIFTFÄRDPLAN</h3>
            {titleSlot ? <div className="fp-document-title-slot fp-no-print">{titleSlot}</div> : null}
            <p>Signatur befälhavare</p>
          </div>
        </div>
        <div className="fp-header-meta-grid">
          <HeaderField label="Planerad start" className="fp-meta-date">
            <div className="fp-header-datetime">
              <input type="date" value={plan.header.date} onChange={(event) => onHeaderChange('date', event.target.value)} />
              <input type="time" value={plan.header.plannedStartTime} onChange={(event) => onHeaderChange('plannedStartTime', event.target.value)} />
            </div>
          </HeaderField>
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
          <HeaderField label="NOTAM kontroll" className="fp-meta-notam">
            <button type="button" className="fp-header-picker fp-header-weather-button" onClick={onOpenNotamPanel}>
              <strong>{plan.header.notamStatus}</strong>
              <small>{notamStatusLabel}</small>
            </button>
          </HeaderField>
          <HeaderField label="Landningsflygplats" className="fp-meta-destination"><input value={plan.header.destinationAerodrome} onChange={(event) => onHeaderChange('destinationAerodrome', event.target.value)} /></HeaderField>
          <HeaderField label="Block ut" className="fp-meta-block-out"><input value={plan.header.blockOut} onChange={(event) => onHeaderChange('blockOut', event.target.value)} /></HeaderField>
          <HeaderField label="Start" className="fp-meta-takeoff"><input value={plan.header.takeoff} onChange={(event) => onHeaderChange('takeoff', event.target.value)} /></HeaderField>
          <HeaderField label="Fpl status" className="fp-meta-fpl-status"><input value={plan.header.fplStatus} onChange={(event) => onHeaderChange('fplStatus', event.target.value)} /></HeaderField>
          <HeaderField label="Daglig tillsyn" className="fp-meta-daily"><input value={plan.header.dailyInspection} onChange={(event) => onHeaderChange('dailyInspection', event.target.value)} /></HeaderField>
          <HeaderField label="Väder / Metar" className="fp-meta-weather">
            <button type="button" className="fp-header-picker fp-header-weather-button" onClick={onOpenWeatherPanel}>
              <strong>{plan.header.weatherStatus}</strong>
              <small>{weatherStatusLabel}</small>
            </button>
          </HeaderField>
          <HeaderField label="Blocktid" className="fp-meta-block-time"><strong></strong></HeaderField>
          <HeaderField label="Flygtid" className="fp-meta-flight-time"><strong></strong></HeaderField>
        </div>
      </section>

      <section className="fp-route-table__wrap">
        <div className="fp-route-weather-meta">
          <div className="fp-route-weather-meta-primary">
            <span>Höjdvind: Open-Meteo</span>
            <label className="fp-route-weather-toggle" aria-label="Hämta vind automatiskt">
              <span>Hämta vind</span>
              <button
                type="button"
                className="fp-route-weather-toggle__button"
                role="switch"
                aria-checked={aloftWindAutoFetchEnabled}
                onClick={() => onAloftWindAutoFetchChange(!aloftWindAutoFetchEnabled)}
              >
                <span className="fp-route-weather-toggle__track" aria-hidden="true">
                  <span className="fp-route-weather-toggle__thumb" />
                </span>
              </button>
            </label>
            {aloftWindAutoFetchEnabled ? (
              <span>
                {aloftWindStatus.status === 'loading' ? 'uppdaterar…' : null}
                {aloftWindStatus.status === 'loading' && aloftWindStatus.lastUpdatedAt ? ' · ' : null}
                {aloftWindStatus.lastUpdatedAt ? `senast hämtad ${formatLocalTimestamp(aloftWindStatus.lastUpdatedAt)}` : null}
              </span>
            ) : null}
          </div>
          <div className="fp-route-weather-meta-actions">
            {aloftWindStatus.status === 'error' && aloftWindStatus.error ? (
              <strong>{aloftWindStatus.error}</strong>
            ) : (
              <small>
                {aloftWindAutoFetchEnabled
                  ? 'Vind hämtas automatiskt när ben, höjd eller planerad start ändras.'
                  : 'När hämtning är av kan `W/v` ändras manuellt och värdet ligger kvar tills du ändrar det eller slår på hämtning.'}
              </small>
            )}
          </div>
        </div>
        <table className="fp-route-table">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '4.2%' }} />
            <col style={{ width: '4.2%' }} />
            <col style={{ width: '4.2%' }} />
            <col style={{ width: '4.2%' }} />
            <col style={{ width: '4.2%' }} />
            <col style={{ width: '4.2%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '13.8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>W/v</th><th className={tasInputUnit === 'mph' ? 'fp-tas-heading is-imperial' : 'fp-tas-heading'}>{`TAS (${tasInputUnit})`}</th><th>TT</th><th>WCA</th><th>TH</th><th>var</th><th>MT</th><th>MH</th><th>Alt</th><th>STRÄCKA</th><th>GS</th><th>DIST INT</th><th>DIST ACC</th><th>TID INT</th><th>TID ACC</th><th>NOTERING</th>
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
                <td className={row.windManual ? 'fp-route-cell-button is-manual' : 'fp-route-cell-button'}>
                  <WindCellInput
                    value={row.wind}
                    isManual={row.windManual}
                    disabled={aloftWindAutoFetchEnabled}
                    onCommit={(value) => onManualWindChange(row.index, value)}
                  />
                </td>
                <td className={tasInputUnit === 'mph' ? 'fp-route-cell-button fp-route-cell-button--imperial' : 'fp-route-cell-button'}>
                  <TasCellInput
                    value={typeof row.tas === 'number' ? row.tas : ''}
                    unit={tasInputUnit}
                    onCommit={(value) => onTasChange(row.index, value)}
                  />
                </td>
                <td className="fp-highlight-cell">{formatDegreeCellValue(row.tt)}</td>
                <td>{formatDegreeCellValue(row.wca)}</td>
                <td>{formatDegreeCellValue(row.th)}</td>
                <td>{formatDegreeCellValue(row.variation)}</td>
                <td className="fp-highlight-cell">{formatDegreeCellValue(row.mt)}</td>
                <td className="fp-highlight-cell">{formatDegreeCellValue(row.mh)}</td>
                <td className="fp-route-cell-button">
                  <AltitudeCellSelect
                    rowIndex={row.index}
                    rootRef={altitudeMenuRootRef}
                    value={row.altitude}
                    trueTrack={typeof row.tt === 'number' ? row.tt : 0}
                    variation={typeof row.variation === 'number' ? row.variation : 0}
                    isActive={activeAltitudeLegIndex === row.index}
                    isOpen={openAltitudeMenuIndex === row.index}
                    onFocus={() => onAltitudeSelect(row.index)}
                    onOpenChange={(nextOpen) => onAltitudeMenuOpenChange(nextOpen ? row.index : null)}
                    onChange={(nextAltitude) => onAltitudeChange(row.index, nextAltitude)}
                    onDragStart={onAltitudeDragStart}
                    onDragEnter={onAltitudeDragEnter}
                    onDragEnd={onAltitudeDragEnd}
                  />
                </td>
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
                <td>{formatUnitCellValue(row.gs, 'kt')}</td>
                <td>{formatUnitCellValue(row.distInt, 'nm')}</td>
                <td>{formatUnitCellValue(row.distAcc, 'nm')}</td>
                <td>{row.timeInt}</td><td>{row.timeAcc}</td><td>{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          {radioNavEntries.map((entry, index) => (
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

        <div
          className={`fp-subtable fp-weight-panel${derived.weightBalance.withinLimits ? '' : ' is-out-of-limits'}`}
          onClick={() => onSectionSelect('weightBalance')}
        >
          <div className="fp-subtable-title">VIKT & BALANS</div>
          <div className="fp-wb-grid">
            <div className="fp-wb-header"><span></span><strong>Vikt</strong><strong>Arm</strong><strong>Moment</strong></div>
            <div><span>Tomvikt</span><span>{formatNumber(derived.aircraft.emptyWeightKg, 1)}</span><span>{formatNumber(derived.aircraft.emptyArmMm)}</span><span>{formatNumber(derived.weightBalance.emptyMomentKgMm)}</span></div>
            {derived.weightBalance.stationLoads.map((station) => (
              <div key={station.stationId}>
                <span>{station.name}</span>
                <span>{formatNumber(station.weightKg, 1)}</span>
                <span>{formatNumber(station.armMm)}</span>
                <span>{formatNumber(station.momentKgMm)}</span>
              </div>
            ))}
            <div><span>{derived.aircraft.fuelStation.name}</span><span>{formatNumber(derived.weightBalance.fuelWeightKg, 1)}</span><span>{formatNumber(derived.aircraft.fuelStation.armMm)}</span><span>{formatNumber(derived.weightBalance.fuelWeightKg * derived.aircraft.fuelStation.armMm)}</span></div>
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
          const label = getRoutePointLabel(point)
          return (
            <g key={`${label}-${index}`}>
              <circle cx={projected.x} cy={projected.y} r="7" fill="#ff35c4" stroke="#ffffff" strokeWidth="3" />
              <text x={projected.x + 10} y={projected.y - 12} fontSize="16" fill="#3a3228" fontWeight="600">
                {label}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="fp-route-legend">
        {legs.map((leg, index) => (
          <div key={`${getRoutePointLabel(leg.from)}-${getRoutePointLabel(leg.to)}-${index}`}>
            <strong>{getRoutePointLabel(leg.from)} → {getRoutePointLabel(leg.to)}</strong>
            <span>{leg.altitude} · {leg.windDirection}/{leg.windSpeedKt} kt</span>
          </div>
        ))}
      </div>
    </div>
  )
}
