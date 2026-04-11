import type { AircraftProfile, FlightPlanInput } from './types'

export const DEFAULT_ROUTE_TAS_KT = 110

function getLocalDateParts() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

export const aircraftProfiles: AircraftProfile[] = [
  {
    registration: 'SE-MDE',
    typeName: 'C172',
    callsign: 'Mike Delta Echo',
    cruiseTasKt: 102,
    fuelBurnLph: 32,
    fuelDensityKgPerLiter: 0.72,
    emptyWeightKg: 735,
    emptyMomentKgMm: 251370,
    armsMm: {
      frontLeft: 940,
      frontRight: 940,
      rearLeft: 1830,
      rearRight: 1830,
      baggage: 2480,
      fuel: 1210,
    },
    limits: {
      maxTowKg: 1110,
      minArmMm: 910,
      maxArmMm: 1220,
    },
    performance: {
      takeoff50FtM: 485,
      landing50FtM: 410,
    },
  },
  {
    registration: 'SE-MCZ',
    typeName: 'Husky',
    callsign: 'Mike Charlie Zulu',
    cruiseTasKt: 95,
    fuelBurnLph: 30,
    fuelDensityKgPerLiter: 0.72,
    emptyWeightKg: 640,
    emptyMomentKgMm: 214500,
    armsMm: {
      frontLeft: 870,
      frontRight: 870,
      rearLeft: 1650,
      rearRight: 1650,
      baggage: 2230,
      fuel: 1090,
    },
    limits: {
      maxTowKg: 998,
      minArmMm: 840,
      maxArmMm: 1120,
    },
    performance: {
      takeoff50FtM: 285,
      landing50FtM: 240,
    },
  },
]

const initialFlightPlanTemplate: FlightPlanInput = {
  aircraftRegistration: 'SE-MDE',
  header: {
    date: getLocalDateParts().date,
    plannedStartTime: getLocalDateParts().time,
    departureAerodrome: 'ESSB',
    destinationAerodrome: 'ESNQ',
    captain: 'A. Martensson',
    observer: 'Spanare',
    notamStatus: 'Kontrollerad',
    weatherStatus: 'METAR/TAF',
    fplStatus: 'Aktiv',
    dailyInspection: 'Utförd',
    blockOut: '09:00',
    takeoff: '',
    landing: '',
    blockIn: '',
  },
  routeLegs: [
    {
      from: { name: 'Bromma', lat: 59.3544, lon: 17.941 },
      to: { name: 'Uppsala', lat: 59.8586, lon: 17.6389 },
      windDirection: 220,
      windSpeedKt: 15,
      manualWind: null,
      tasKt: DEFAULT_ROUTE_TAS_KT,
      variation: 0,
      altitude: "2500'",
      navRef: 'UPP',
      notes: 'Utpassage norr',
    },
    {
      from: { name: 'Uppsala', lat: 59.8586, lon: 17.6389 },
      to: { name: 'Gävle', lat: 60.5933, lon: 17.4594 },
      windDirection: 230,
      windSpeedKt: 18,
      manualWind: null,
      tasKt: DEFAULT_ROUTE_TAS_KT,
      variation: 0,
      altitude: "3000'",
      navRef: 'GVE',
      notes: '',
    },
    {
      from: { name: 'Gävle', lat: 60.5933, lon: 17.4594 },
      to: { name: 'Söderhamn', lat: 61.2608, lon: 17.1014 },
      windDirection: 240,
      windSpeedKt: 16,
      manualWind: null,
      tasKt: DEFAULT_ROUTE_TAS_KT,
      variation: 0,
      altitude: "3500'",
      navRef: 'SDH',
      notes: 'Kustlinje',
    },
  ],
  radioNav: Array.from({ length: 12 }, (_, index) => ({
    name: index === 0 ? 'Stockholm Radio' : 'Funktion',
    frequency: index === 0 ? '124.700' : 'Frekvens',
  })),
  performance: {
    availableTakeoffDistanceM: 800,
    availableLandingDistanceM: 820,
    aerodromeElevationFt: 47,
    temperatureC: 18,
    runwaySurface: 'Asfalt',
    runwayCondition: 'Torr',
    headwindKt: 8,
  },
  fuel: {
    reserveMinutes: 45,
    extraOnBoardLiters: 8,
  },
  weightBalance: {
    frontLeftKg: 84,
    frontRightKg: 78,
    rearLeftKg: 0,
    rearRightKg: 72,
    baggageKg: 18,
  },
}

export function createInitialFlightPlan(): FlightPlanInput {
  const now = getLocalDateParts()
  return {
    ...initialFlightPlanTemplate,
    header: {
      ...initialFlightPlanTemplate.header,
      date: now.date,
      plannedStartTime: now.time,
    },
    routeLegs: initialFlightPlanTemplate.routeLegs.map((leg) => ({
      ...leg,
      from: { ...leg.from },
      to: { ...leg.to },
    })),
    radioNav: initialFlightPlanTemplate.radioNav.map((entry) => ({ ...entry })),
    performance: { ...initialFlightPlanTemplate.performance },
    fuel: { ...initialFlightPlanTemplate.fuel },
    weightBalance: { ...initialFlightPlanTemplate.weightBalance },
  }
}

export function createEmptyFlightPlan(): FlightPlanInput {
  const plan = createInitialFlightPlan()

  return {
    ...plan,
    header: {
      ...plan.header,
      departureAerodrome: '',
      destinationAerodrome: '',
    },
    routeLegs: [],
  }
}
