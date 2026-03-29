import type {
  AircraftProfile,
  DerivedRouteLeg,
  FlightPlanDerived,
  FlightPlanInput,
  PerformanceDerived,
  WeightBalanceDerived,
} from './types'

const earthRadiusNm = 3440.065

function degToRad(value: number) {
  return (value * Math.PI) / 180
}

function radToDeg(value: number) {
  return (value * 180) / Math.PI
}

function normalizeDegrees(value: number) {
  const result = value % 360
  return result < 0 ? result + 360 : result
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function distanceNm(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const lat1 = degToRad(fromLat)
  const lat2 = degToRad(toLat)
  const dLat = degToRad(toLat - fromLat)
  const dLon = degToRad(toLon - fromLon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function initialBearing(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const lat1 = degToRad(fromLat)
  const lat2 = degToRad(toLat)
  const dLon = degToRad(toLon - fromLon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return normalizeDegrees(radToDeg(Math.atan2(y, x)))
}

function computeLeg(
  input: FlightPlanInput['routeLegs'][number],
  accumulatedDistanceNm: number,
  accumulatedTimeMinutes: number,
): DerivedRouteLeg {
  const trueTrack = initialBearing(input.from.lat, input.from.lon, input.to.lat, input.to.lon)
  const distance = distanceNm(input.from.lat, input.from.lon, input.to.lat, input.to.lon)
  const relativeWindRad = degToRad(input.windDirection - trueTrack)
  const windRatio = Math.max(
    -1,
    Math.min(1, (input.windSpeedKt / Math.max(input.tasKt, 1)) * Math.sin(relativeWindRad)),
  )
  const windCorrectionAngle = radToDeg(Math.asin(windRatio))
  const trueHeading = normalizeDegrees(trueTrack + windCorrectionAngle)
  const groundSpeedKt = Math.max(
    45,
    input.tasKt * Math.cos(degToRad(windCorrectionAngle)) - input.windSpeedKt * Math.cos(relativeWindRad),
  )
  const legTimeMinutes = (distance / groundSpeedKt) * 60

  return {
    trueTrack: round(trueTrack),
    distanceNm: round(distance, 1),
    windCorrectionAngle: round(windCorrectionAngle),
    trueHeading: round(trueHeading),
    magneticHeading: round(normalizeDegrees(trueHeading - input.variation)),
    groundSpeedKt: round(groundSpeedKt),
    legTimeMinutes: round(legTimeMinutes),
    accumulatedDistanceNm: round(accumulatedDistanceNm + distance, 1),
    accumulatedTimeMinutes: round(accumulatedTimeMinutes + legTimeMinutes),
    segmentName: `${input.from.name} - ${input.to.name}`,
    windText: `${input.windDirection}/${input.windSpeedKt}`,
  }
}

function getAircraft(registration: string, aircraftProfiles: AircraftProfile[]): AircraftProfile {
  return aircraftProfiles.find((aircraft) => aircraft.registration === registration) ?? aircraftProfiles[0]
}

function computeWeightBalance(
  plan: FlightPlanInput,
  aircraft: AircraftProfile,
  fuelLiters: number,
): WeightBalanceDerived {
  const frontKg = plan.weightBalance.frontLeftKg + plan.weightBalance.frontRightKg
  const rearKg = plan.weightBalance.rearLeftKg + plan.weightBalance.rearRightKg
  const baggageKg = plan.weightBalance.baggageKg
  const fuelWeightKg = fuelLiters * aircraft.fuelDensityKgPerLiter

  const totalMomentKgMm =
    aircraft.emptyMomentKgMm +
    plan.weightBalance.frontLeftKg * aircraft.armsMm.frontLeft +
    plan.weightBalance.frontRightKg * aircraft.armsMm.frontRight +
    plan.weightBalance.rearLeftKg * aircraft.armsMm.rearLeft +
    plan.weightBalance.rearRightKg * aircraft.armsMm.rearRight +
    baggageKg * aircraft.armsMm.baggage +
    fuelWeightKg * aircraft.armsMm.fuel

  const towKg = aircraft.emptyWeightKg + frontKg + rearKg + baggageKg + fuelWeightKg
  const armMm = totalMomentKgMm / towKg

  return {
    frontKg: round(frontKg, 1),
    rearKg: round(rearKg, 1),
    baggageKg: round(baggageKg, 1),
    fuelWeightKg: round(fuelWeightKg, 1),
    towKg: round(towKg, 1),
    totalMomentKgMm: round(totalMomentKgMm),
    armMm: round(armMm),
    withinLimits:
      towKg <= aircraft.limits.maxTowKg &&
      armMm >= aircraft.limits.minArmMm &&
      armMm <= aircraft.limits.maxArmMm,
  }
}

function computePerformance(
  plan: FlightPlanInput,
  aircraft: AircraftProfile,
  weightBalance: WeightBalanceDerived,
): PerformanceDerived {
  const weightFactor = 1 + (weightBalance.towKg - aircraft.emptyWeightKg) / 2000
  const elevationFactor = 1 + plan.performance.aerodromeElevationFt / 5000
  const temperatureFactor = 1 + Math.max(0, plan.performance.temperatureC - 15) * 0.01
  const surfaceFactor =
    plan.performance.runwaySurface === 'Gräs'
      ? plan.performance.runwayCondition === 'Mjuk'
        ? 1.28
        : 1.15
      : plan.performance.runwayCondition === 'Våt'
        ? 1.08
        : 1
  const windFactor = 1 - Math.min(0.2, plan.performance.headwindKt * 0.01)

  const takeoffPohM = aircraft.performance.takeoff50FtM
  const landingPohM = aircraft.performance.landing50FtM
  const takeoffCorrectedM = takeoffPohM * weightFactor * elevationFactor * temperatureFactor * surfaceFactor * windFactor
  const landingCorrectedM = landingPohM * weightFactor * elevationFactor * temperatureFactor * surfaceFactor * windFactor
  const takeoffRequiredM = takeoffCorrectedM * 1.33
  const landingRequiredM = landingCorrectedM * 1.43

  return {
    takeoffPohM: round(takeoffPohM),
    takeoffCorrectedM: round(takeoffCorrectedM),
    takeoffRequiredM: round(takeoffRequiredM),
    landingPohM: round(landingPohM),
    landingCorrectedM: round(landingCorrectedM),
    landingRequiredM: round(landingRequiredM),
    takeoffMarginM: round(plan.performance.availableTakeoffDistanceM - takeoffRequiredM),
    landingMarginM: round(plan.performance.availableLandingDistanceM - landingRequiredM),
  }
}

export function calculateFlightPlan(plan: FlightPlanInput, aircraftProfiles: AircraftProfile[]): FlightPlanDerived {
  const aircraft = getAircraft(plan.aircraftRegistration, aircraftProfiles)

  let accumulatedDistance = 0
  let accumulatedTime = 0
  const routeLegs = plan.routeLegs.map((leg) => {
    const result = computeLeg(leg, accumulatedDistance, accumulatedTime)
    accumulatedDistance = result.accumulatedDistanceNm
    accumulatedTime = result.accumulatedTimeMinutes
    return result
  })

  const totalFlightTimeMinutes = routeLegs.reduce((sum, leg) => sum + leg.legTimeMinutes, 0)
  const burnRateLph = plan.fuel.burnOverrideLph ?? aircraft.fuelBurnLph
  const tripLiters = (totalFlightTimeMinutes / 60) * burnRateLph
  const contingencyLiters = tripLiters * 0.1
  const reserveLiters = (plan.fuel.reserveMinutes / 60) * burnRateLph
  const totalPlannedLiters = tripLiters + contingencyLiters + reserveLiters
  const totalOnBoardLiters = totalPlannedLiters + plan.fuel.extraOnBoardLiters

  const fuel = {
    burnRateLph: round(burnRateLph, 1),
    tripLiters: round(tripLiters, 1),
    contingencyLiters: round(contingencyLiters, 1),
    reserveLiters: round(reserveLiters, 1),
    totalPlannedLiters: round(totalPlannedLiters, 1),
    totalOnBoardLiters: round(totalOnBoardLiters, 1),
    tripTimeMinutes: round(totalFlightTimeMinutes),
  }

  const weightBalance = computeWeightBalance(plan, aircraft, totalOnBoardLiters)
  const performance = computePerformance(plan, aircraft, weightBalance)

  return {
    aircraft,
    routeLegs,
    totals: {
      distanceNm: round(routeLegs.at(-1)?.accumulatedDistanceNm ?? 0, 1),
      flightTimeMinutes: round(totalFlightTimeMinutes),
      blockTimeMinutes: round(totalFlightTimeMinutes + 12),
    },
    fuel,
    weightBalance,
    performance,
  }
}

export function formatTimeFromMinutes(totalMinutes: number) {
  const safeValue = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(safeValue / 60)
    .toString()
    .padStart(2, '0')
  const minutes = (safeValue % 60).toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

export function formatNumber(value: number, digits = 0) {
  return value.toFixed(digits)
}
