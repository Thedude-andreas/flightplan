import wmm2025Cof from './wmm/WMM2025.COF?raw'
import type { FlightPlanInput } from './types'
import { parseAltitudeFeet } from './weatherRoute'

const WGS84_SEMI_MAJOR_AXIS_KM = 6378.137
const WGS84_SEMI_MINOR_AXIS_KM = 6356.7523142
const WGS84_FIRST_ECCENTRICITY_SQUARED =
  1 - (WGS84_SEMI_MINOR_AXIS_KM * WGS84_SEMI_MINOR_AXIS_KM) / (WGS84_SEMI_MAJOR_AXIS_KM * WGS84_SEMI_MAJOR_AXIS_KM)
const EARTH_REFERENCE_RADIUS_KM = 6371.2
const METERS_PER_FOOT = 0.3048
const KILOMETERS_PER_METER = 0.001
const DEGREE_EPSILON = 1e-10

type MagneticModel = {
  epoch: number
  name: string
  nMax: number
  nMaxSecVar: number
  g: number[]
  h: number[]
  gDot: number[]
  hDot: number[]
}

export type RouteLegMagneticVariation = {
  declination: number
  midpoint: { lat: number; lon: number }
  altitudeMetersMsl: number
  model: string
  decimalYear: number
}

function coefficientIndex(n: number, m: number) {
  return (n * (n + 1)) / 2 + m
}

function roundToNearestDegree(value: number) {
  return Math.round(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function parseModel(rawCoefficients: string): MagneticModel {
  const lines = rawCoefficients
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const [epochToken = '', nameToken = 'WMM'] = lines[0]?.split(/\s+/) ?? []
  const coefficients = lines
    .slice(1)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 6 && parts[0] !== '9999')
    .map(([n, m, gnm, hnm, dgnm, dhnm]) => ({
      n: Number(n),
      m: Number(m),
      gnm: Number(gnm),
      hnm: Number(hnm),
      dgnm: Number(dgnm),
      dhnm: Number(dhnm),
    }))

  const nMax = coefficients.reduce((highest, coefficient) => Math.max(highest, coefficient.n), 0)
  const arrayLength = coefficientIndex(nMax, nMax) + 1
  const g = Array.from({ length: arrayLength }, () => 0)
  const h = Array.from({ length: arrayLength }, () => 0)
  const gDot = Array.from({ length: arrayLength }, () => 0)
  const hDot = Array.from({ length: arrayLength }, () => 0)

  let nMaxSecVar = 0
  for (const coefficient of coefficients) {
    const index = coefficientIndex(coefficient.n, coefficient.m)
    g[index] = coefficient.gnm
    h[index] = coefficient.hnm
    gDot[index] = coefficient.dgnm
    hDot[index] = coefficient.dhnm

    if (coefficient.dgnm !== 0 || coefficient.dhnm !== 0) {
      nMaxSecVar = Math.max(nMaxSecVar, coefficient.n)
    }
  }

  return {
    epoch: Number(epochToken),
    name: nameToken,
    nMax,
    nMaxSecVar,
    g,
    h,
    gDot,
    hDot,
  }
}

const WMM_2025_MODEL = parseModel(wmm2025Cof)

function toDecimalYear(date: Date) {
  const year = date.getFullYear()
  const yearStart = new Date(year, 0, 1)
  const nextYearStart = new Date(year + 1, 0, 1)
  return year + (date.getTime() - yearStart.getTime()) / (nextYearStart.getTime() - yearStart.getTime())
}

function getPlannedStartDate(date: string, time: string) {
  const normalizedDate = date.trim()
  if (!normalizedDate) {
    return new Date()
  }

  const normalizedTime = time.trim() || '12:00'
  const plannedStart = new Date(`${normalizedDate}T${normalizedTime}`)
  return Number.isNaN(plannedStart.getTime()) ? new Date(`${normalizedDate}T12:00`) : plannedStart
}

function getAltitudeMetersMsl(altitudeLabel: string) {
  const altitudeFeet = parseAltitudeFeet(altitudeLabel.trim()) ?? 3000
  return altitudeFeet * METERS_PER_FOOT
}

function getMidpoint(leg: FlightPlanInput['routeLegs'][number]) {
  return {
    lat: (leg.from.lat + leg.to.lat) / 2,
    lon: (leg.from.lon + leg.to.lon) / 2,
  }
}

function computeLegendreLow(sineGeocentricLatitude: number, nMax: number) {
  const x = clamp(sineGeocentricLatitude, -1, 1)
  const z = Math.sqrt(Math.max(0, (1 - x) * (1 + x)))
  const termCount = ((nMax + 1) * (nMax + 2)) / 2
  const p = Array.from({ length: termCount }, () => 0)
  const dp = Array.from({ length: termCount }, () => 0)
  const schmidt = Array.from({ length: termCount }, () => 0)

  p[0] = 1
  schmidt[0] = 1

  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const index = coefficientIndex(n, m)
      if (n === m) {
        const index1 = coefficientIndex(n - 1, m - 1)
        p[index] = z * p[index1]
        dp[index] = z * dp[index1] + x * p[index1]
      } else if (n === 1 && m === 0) {
        const index1 = coefficientIndex(n - 1, m)
        p[index] = x * p[index1]
        dp[index] = x * dp[index1] - z * p[index1]
      } else {
        const index1 = coefficientIndex(n - 2, m)
        const index2 = coefficientIndex(n - 1, m)
        if (m > n - 2) {
          p[index] = x * p[index2]
          dp[index] = x * dp[index2] - z * p[index2]
        } else {
          const k = (((n - 1) * (n - 1)) - m * m) / ((2 * n - 1) * (2 * n - 3))
          p[index] = x * p[index2] - k * p[index1]
          dp[index] = x * dp[index2] - z * p[index2] - k * dp[index1]
        }
      }
    }
  }

  for (let n = 1; n <= nMax; n += 1) {
    const index = coefficientIndex(n, 0)
    const previousIndex = coefficientIndex(n - 1, 0)
    schmidt[index] = schmidt[previousIndex] * ((2 * n - 1) / n)

    for (let m = 1; m <= n; m += 1) {
      const currentIndex = coefficientIndex(n, m)
      const previousOrderIndex = coefficientIndex(n, m - 1)
      schmidt[currentIndex] =
        schmidt[previousOrderIndex] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m))
    }
  }

  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const index = coefficientIndex(n, m)
      p[index] *= schmidt[index]
      dp[index] *= -schmidt[index]
    }
  }

  return { p, dp }
}

function computeSphericalCoordinates(latitudeDeg: number, longitudeDeg: number, altitudeKm: number) {
  const latitudeRad = (latitudeDeg * Math.PI) / 180
  const cosineLatitude = Math.cos(latitudeRad)
  const sineLatitude = Math.sin(latitudeRad)
  const radiusOfCurvature =
    WGS84_SEMI_MAJOR_AXIS_KM / Math.sqrt(1 - WGS84_FIRST_ECCENTRICITY_SQUARED * sineLatitude * sineLatitude)
  const x = (radiusOfCurvature + altitudeKm) * cosineLatitude
  const z =
    (radiusOfCurvature * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED) + altitudeKm) * sineLatitude
  const r = Math.sqrt(x * x + z * z)

  return {
    lambda: longitudeDeg,
    phig: (Math.asin(z / r) * 180) / Math.PI,
    r,
  }
}

function computeSphericalHarmonicVariables(lambdaDeg: number, r: number, nMax: number) {
  const lambdaRad = (lambdaDeg * Math.PI) / 180
  const cosineLambda = Math.cos(lambdaRad)
  const sineLambda = Math.sin(lambdaRad)
  const relativeRadiusPower = Array.from({ length: nMax + 1 }, () => 0)
  const cosMLambda = Array.from({ length: nMax + 1 }, () => 0)
  const sinMLambda = Array.from({ length: nMax + 1 }, () => 0)

  relativeRadiusPower[0] = (EARTH_REFERENCE_RADIUS_KM / r) * (EARTH_REFERENCE_RADIUS_KM / r)
  for (let n = 1; n <= nMax; n += 1) {
    relativeRadiusPower[n] = relativeRadiusPower[n - 1] * (EARTH_REFERENCE_RADIUS_KM / r)
  }

  cosMLambda[0] = 1
  sinMLambda[0] = 0
  if (nMax >= 1) {
    cosMLambda[1] = cosineLambda
    sinMLambda[1] = sineLambda
  }
  for (let m = 2; m <= nMax; m += 1) {
    cosMLambda[m] = cosMLambda[m - 1] * cosineLambda - sinMLambda[m - 1] * sineLambda
    sinMLambda[m] = cosMLambda[m - 1] * sineLambda + sinMLambda[m - 1] * cosineLambda
  }

  return { relativeRadiusPower, cosMLambda, sinMLambda }
}

function computePolarBy(
  model: MagneticModel,
  decimalYear: number,
  sineGeocentricLatitude: number,
  relativeRadiusPower: number[],
  cosMLambda: number[],
  sinMLambda: number[],
) {
  const p = Array.from({ length: model.nMax + 1 }, () => 0)
  p[0] = 1

  let schmidt1 = 1
  let by = 0
  for (let n = 1; n <= model.nMax; n += 1) {
    const index = coefficientIndex(n, 1)
    const schmidt2 = schmidt1 * ((2 * n - 1) / n)
    const schmidt3 = schmidt2 * Math.sqrt((2 * n) / (n + 1))
    schmidt1 = schmidt2

    if (n === 1) {
      p[n] = p[n - 1]
    } else {
      const k = (((n - 1) * (n - 1)) - 1) / ((2 * n - 1) * (2 * n - 3))
      p[n] = sineGeocentricLatitude * p[n - 1] - k * p[n - 2]
    }

    const g = model.g[index] + (n <= model.nMaxSecVar ? (decimalYear - model.epoch) * model.gDot[index] : 0)
    const h = model.h[index] + (n <= model.nMaxSecVar ? (decimalYear - model.epoch) * model.hDot[index] : 0)
    by += relativeRadiusPower[n] * (g * sinMLambda[1] - h * cosMLambda[1]) * p[n] * schmidt3
  }

  return by
}

export function calculateMagneticVariation(
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeMetersMsl: number,
  date: Date,
) {
  const geodeticLatitude = clamp(latitudeDeg, -89.99999, 89.99999)
  const altitudeKm = altitudeMetersMsl * KILOMETERS_PER_METER
  const decimalYear = toDecimalYear(date)
  const spherical = computeSphericalCoordinates(geodeticLatitude, longitudeDeg, altitudeKm)
  const sineGeocentricLatitude = Math.sin((spherical.phig * Math.PI) / 180)
  const { p, dp } = computeLegendreLow(sineGeocentricLatitude, WMM_2025_MODEL.nMax)
  const { relativeRadiusPower, cosMLambda, sinMLambda } = computeSphericalHarmonicVariables(
    spherical.lambda,
    spherical.r,
    WMM_2025_MODEL.nMax,
  )

  let bx = 0
  let by = 0
  let bz = 0
  const yearsFromEpoch = decimalYear - WMM_2025_MODEL.epoch

  for (let n = 1; n <= WMM_2025_MODEL.nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const index = coefficientIndex(n, m)
      const g =
        WMM_2025_MODEL.g[index] +
        (n <= WMM_2025_MODEL.nMaxSecVar ? yearsFromEpoch * WMM_2025_MODEL.gDot[index] : 0)
      const h =
        WMM_2025_MODEL.h[index] +
        (n <= WMM_2025_MODEL.nMaxSecVar ? yearsFromEpoch * WMM_2025_MODEL.hDot[index] : 0)
      const harmonic = g * cosMLambda[m] + h * sinMLambda[m]

      bz -= relativeRadiusPower[n] * (n + 1) * harmonic * p[index]
      by += relativeRadiusPower[n] * (g * sinMLambda[m] - h * cosMLambda[m]) * m * p[index]
      bx -= relativeRadiusPower[n] * harmonic * dp[index]
    }
  }

  const cosineGeocentricLatitude = Math.cos((spherical.phig * Math.PI) / 180)
  if (Math.abs(cosineGeocentricLatitude) > DEGREE_EPSILON) {
    by /= cosineGeocentricLatitude
  } else {
    by = computePolarBy(
      WMM_2025_MODEL,
      decimalYear,
      sineGeocentricLatitude,
      relativeRadiusPower,
      cosMLambda,
      sinMLambda,
    )
  }

  const psi = ((spherical.phig - geodeticLatitude) * Math.PI) / 180
  const geodeticBx = bx * Math.cos(psi) - bz * Math.sin(psi)
  const geodeticBy = by
  const declination = (Math.atan2(geodeticBy, geodeticBx) * 180) / Math.PI

  return {
    declination: roundToNearestDegree(declination),
    decimalYear,
    model: WMM_2025_MODEL.name,
  }
}

export function calculateRouteLegMagneticVariations(
  routeLegs: FlightPlanInput['routeLegs'],
  date: string,
  time: string,
): RouteLegMagneticVariation[] {
  if (routeLegs.length === 0) {
    return []
  }

  const plannedStart = getPlannedStartDate(date, time)
  return routeLegs.map((leg) => {
    const midpoint = getMidpoint(leg)
    const altitudeMetersMsl = getAltitudeMetersMsl(leg.altitude)
    const magneticVariation = calculateMagneticVariation(midpoint.lat, midpoint.lon, altitudeMetersMsl, plannedStart)

    return {
      declination: magneticVariation.declination,
      midpoint,
      altitudeMetersMsl,
      model: magneticVariation.model,
      decimalYear: magneticVariation.decimalYear,
    }
  })
}
