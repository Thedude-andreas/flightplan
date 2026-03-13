export type AircraftProfile = {
  registration: string
  typeName: string
  callsign: string
  cruiseTasKt: number
  fuelBurnLph: number
  fuelDensityKgPerLiter: number
  emptyWeightKg: number
  emptyMomentKgMm: number
  armsMm: {
    frontLeft: number
    frontRight: number
    rearLeft: number
    rearRight: number
    baggage: number
    fuel: number
  }
  limits: {
    maxTowKg: number
    minArmMm: number
    maxArmMm: number
  }
  performance: {
    takeoff50FtM: number
    landing50FtM: number
  }
}

export type HeaderInput = {
  date: string
  departureAerodrome: string
  destinationAerodrome: string
  captain: string
  observer: string
  notamStatus: string
  weatherStatus: string
  fplStatus: string
  dailyInspection: string
  blockOut: string
  takeoff: string
  landing: string
  blockIn: string
}

export type RoutePointInput = {
  name: string
  lat: number
  lon: number
}

export type RouteLegInput = {
  from: RoutePointInput
  to: RoutePointInput
  windDirection: number
  windSpeedKt: number
  tasKt: number
  variation: number
  altitude: string
  navRef: string
  notes: string
}

export type RadioNavEntry = {
  name: string
  frequency: string
}

export type PerformanceInput = {
  availableTakeoffDistanceM: number
  availableLandingDistanceM: number
  aerodromeElevationFt: number
  temperatureC: number
  runwaySurface: 'Asfalt' | 'Gräs'
  runwayCondition: 'Torr' | 'Våt' | 'Mjuk'
  headwindKt: number
}

export type FuelInput = {
  reserveMinutes: number
  extraOnBoardLiters: number
  burnOverrideLph?: number
}

export type WeightBalanceInput = {
  frontLeftKg: number
  frontRightKg: number
  rearLeftKg: number
  rearRightKg: number
  baggageKg: number
}

export type FlightPlanInput = {
  aircraftRegistration: string
  header: HeaderInput
  routeLegs: RouteLegInput[]
  radioNav: RadioNavEntry[]
  performance: PerformanceInput
  fuel: FuelInput
  weightBalance: WeightBalanceInput
}

export type DerivedRouteLeg = {
  trueTrack: number
  distanceNm: number
  windCorrectionAngle: number
  trueHeading: number
  magneticHeading: number
  groundSpeedKt: number
  legTimeMinutes: number
  accumulatedDistanceNm: number
  accumulatedTimeMinutes: number
  segmentName: string
  windText: string
}

export type WeightBalanceDerived = {
  frontKg: number
  rearKg: number
  baggageKg: number
  fuelWeightKg: number
  towKg: number
  totalMomentKgMm: number
  armMm: number
  withinLimits: boolean
}

export type FuelDerived = {
  burnRateLph: number
  tripLiters: number
  contingencyLiters: number
  reserveLiters: number
  totalPlannedLiters: number
  totalOnBoardLiters: number
  tripTimeMinutes: number
}

export type PerformanceDerived = {
  takeoffPohM: number
  takeoffCorrectedM: number
  takeoffRequiredM: number
  landingPohM: number
  landingCorrectedM: number
  landingRequiredM: number
  takeoffMarginM: number
  landingMarginM: number
}

export type FlightPlanDerived = {
  aircraft: AircraftProfile
  routeLegs: DerivedRouteLeg[]
  totals: {
    distanceNm: number
    flightTimeMinutes: number
    blockTimeMinutes: number
  }
  fuel: FuelDerived
  weightBalance: WeightBalanceDerived
  performance: PerformanceDerived
}
