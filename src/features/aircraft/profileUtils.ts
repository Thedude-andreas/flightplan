import type { AircraftProfile as LegacyAircraftProfile } from '../flightplan/types'
import type {
  AircraftConflict,
  AircraftConflictChoice,
  AircraftProfile,
  AircraftRegistrySnapshot,
  AircraftSourceKind,
  AircraftSourceRecord,
  AircraftStation,
  FuelTank,
  MeasurementUnit,
  MeasurementValue,
} from './profileTypes'

const POUNDS_PER_KILOGRAM = 2.2046226218
const LITERS_PER_US_GALLON = 3.785411784
const KNOTS_PER_MPH = 0.8689762419
const FEET_PER_METER = 3.280839895
const MILLIMETERS_PER_CENTIMETER = 10
const MILLIMETERS_PER_INCH = 25.4

function randomId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeRegistration(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
}

export function isValidSwedishRegistration(value: string) {
  return /^SE-[A-Z]{3}$/.test(normalizeRegistration(value))
}

export function convertValue(value: number, from: MeasurementUnit, to: MeasurementUnit) {
  if (from === to) {
    return value
  }

  const metricValue = (() => {
    switch (from) {
      case 'lb':
        return value / POUNDS_PER_KILOGRAM
      case 'gal_us':
        return value * LITERS_PER_US_GALLON
      case 'mph':
        return value * KNOTS_PER_MPH
      case 'ft':
        return value / FEET_PER_METER
      case 'cm':
        return value * MILLIMETERS_PER_CENTIMETER
      case 'in':
        return value * MILLIMETERS_PER_INCH
      default:
        return value
    }
  })()

  switch (to) {
    case 'lb':
      return metricValue * POUNDS_PER_KILOGRAM
    case 'gal_us':
      return metricValue / LITERS_PER_US_GALLON
    case 'mph':
      return metricValue / KNOTS_PER_MPH
    case 'ft':
      return metricValue * FEET_PER_METER
    case 'cm':
      return metricValue / MILLIMETERS_PER_CENTIMETER
    case 'in':
      return metricValue / MILLIMETERS_PER_INCH
    default:
      return metricValue
  }
}

export function roundValue(value: number, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function createMeasurement(
  value: number,
  originalUnit: MeasurementUnit,
  canonicalUnit: MeasurementUnit,
): MeasurementValue {
  return {
    value: roundValue(convertValue(value, originalUnit, canonicalUnit), canonicalUnit === 'mm' ? 0 : 1),
    unit: canonicalUnit,
    originalValue: roundValue(value, originalUnit === 'mm' ? 0 : 1),
    originalUnit,
  }
}

export function createCanonicalMeasurement(value: number, unit: MeasurementUnit): MeasurementValue {
  return {
    value: roundValue(value, unit === 'mm' ? 0 : 1),
    unit,
    originalValue: roundValue(value, unit === 'mm' ? 0 : 1),
    originalUnit: unit,
  }
}

export function formatMeasurement(value: MeasurementValue | null, preferredUnit?: MeasurementUnit) {
  if (!value) {
    return 'Saknas'
  }

  const unit = preferredUnit ?? value.originalUnit ?? value.unit
  const displayValue = unit === value.unit ? value.value : roundValue(convertValue(value.value, value.unit, unit), unit === 'mm' ? 0 : 1)
  return `${displayValue} ${unit}`
}

function createTemplateStation(name: string, kind: AircraftStation['kind']) {
  return {
    id: randomId('station'),
    name,
    kind,
    arm: null,
    defaultWeight: null,
    maxWeight: null,
  } satisfies AircraftStation
}

function createTemplateFuelTank() {
  return {
    id: randomId('fuel'),
    name: 'Bränsle',
    arm: null,
    capacity: null,
    unusable: null,
    defaultFuel: null,
  } satisfies FuelTank
}

export function createEmptyAircraftProfile(origin: AircraftSourceKind = 'manual'): AircraftProfile {
  return {
    schemaVersion: 2,
    profileOrigin: origin,
    displayName: '',
    notes: '',
    identity: {
      registration: 'SE-',
      manufacturer: '',
      model: '',
      variant: '',
      serialNumber: '',
      yearOfManufacture: null,
      registeredOwner: '',
    },
    registrySnapshot: null,
    sources: [],
    conflicts: [],
    unitPreferences: {
      weight: 'kg',
      fuelVolume: 'l',
      arm: 'mm',
      tas: 'kt',
      runwayDistance: 'm',
    },
    weightBalance: {
      emptyWeight: null,
      maxTakeoffWeight: null,
      emptyArm: null,
      stations: [
        createTemplateStation('Framsits', 'seat'),
        createTemplateStation('Baksits', 'seat'),
        createTemplateStation('Bagage 1', 'baggage'),
        createTemplateStation('Bagage 2', 'baggage'),
      ],
      fuelTanks: [createTemplateFuelTank()],
      cgEnvelope: [],
    },
    fuel: {
      fuelType: '',
      alternateFuelType: '',
      maxFuel: null,
      taxiFuel: null,
      landingFuel: null,
      reserveMinutes: 45,
      contingencyFraction: 0.1,
      hourlyCostSek: null,
      hourlyCostIncludesFuel: false,
    },
    performance: {
      serviceCeilingFt: null,
      glideAirspeed: null,
      glideRatio: null,
      defaultCruiseAltitudeFt: null,
      climb: {
        indicatedAirspeed: null,
        rateOfClimbSeaLevelFpm: null,
        rateOfClimbServiceCeilingFpm: null,
        fuelBurnSeaLevel: null,
        fuelBurnServiceCeiling: null,
      },
      descent: {
        indicatedAirspeed: null,
        descentRateFpm: null,
        fuelBurn: null,
      },
      cruiseProfiles: [],
    },
    planningDefaults: {
      tasInputUnit: 'kt',
      reserveMinutes: 45,
      defaultCruiseProfileId: null,
    },
    sharing: {
      mode: 'private',
      communityName: null,
    },
  }
}

export function ensureDisplayName(profile: AircraftProfile) {
  if (profile.displayName.trim()) {
    return profile.displayName.trim()
  }

  if (profile.identity.registration.trim()) {
    return profile.identity.registration.trim()
  }

  return 'Ny flygplansprofil'
}

export function createSourceRecord(
  kind: AircraftSourceKind,
  label: string,
  options: Partial<Omit<AircraftSourceRecord, 'id' | 'kind' | 'label' | 'importedAt'>> = {},
): AircraftSourceRecord {
  return {
    id: randomId('source'),
    kind,
    label,
    importedAt: new Date().toISOString(),
    fileName: options.fileName ?? null,
    summary: options.summary ?? null,
  }
}

function sanitizeStations(stations: AircraftStation[]) {
  return stations.filter((station) =>
    station.name.trim() &&
    (station.arm || station.defaultWeight || station.maxWeight),
  )
}

function sanitizeFuelTanks(fuelTanks: FuelTank[]) {
  return fuelTanks.filter((tank) =>
    tank.name.trim() &&
    (tank.arm || tank.capacity || tank.unusable || tank.defaultFuel),
  )
}

export function sanitizeAircraftProfile(profile: AircraftProfile) {
  const nextDisplayName = ensureDisplayName(profile)
  return {
    ...profile,
    displayName: nextDisplayName,
    identity: {
      ...profile.identity,
      registration: normalizeRegistration(profile.identity.registration),
      manufacturer: profile.identity.manufacturer.trim(),
      model: profile.identity.model.trim(),
      variant: profile.identity.variant.trim(),
      serialNumber: profile.identity.serialNumber.trim(),
      registeredOwner: profile.identity.registeredOwner.trim(),
    },
    notes: profile.notes.trim(),
    weightBalance: {
      ...profile.weightBalance,
      stations: sanitizeStations(profile.weightBalance.stations),
      fuelTanks: sanitizeFuelTanks(profile.weightBalance.fuelTanks),
    },
    sources: profile.sources,
    conflicts: profile.conflicts,
  } satisfies AircraftProfile
}

export function applyRegistrySnapshot(profile: AircraftProfile, snapshot: AircraftRegistrySnapshot) {
  const nextProfile: AircraftProfile = {
    ...profile,
    identity: {
      ...profile.identity,
      registration: profile.identity.registration || snapshot.registration,
      manufacturer: profile.identity.manufacturer || snapshot.manufacturer,
      model: profile.identity.model || snapshot.model,
      serialNumber: profile.identity.serialNumber || snapshot.serialNumber,
      yearOfManufacture: profile.identity.yearOfManufacture ?? snapshot.yearOfManufacture,
      registeredOwner: profile.identity.registeredOwner || snapshot.registeredOwners[0] || snapshot.registeredOperator,
    },
    registrySnapshot: snapshot,
    sources: [
      createSourceRecord('transportstyrelsen', 'Transportstyrelsen', {
        summary: `Lookup ${snapshot.registration}`,
      }),
      ...profile.sources.filter((source) => source.kind !== 'transportstyrelsen'),
    ],
  }

  if (snapshot.maxTakeoffWeightKg && !nextProfile.weightBalance.maxTakeoffWeight) {
    nextProfile.weightBalance.maxTakeoffWeight = createCanonicalMeasurement(snapshot.maxTakeoffWeightKg, 'kg')
  }

  return nextProfile
}

function readValueAtPath(profile: AircraftProfile, path: string): string {
  switch (path) {
    case 'identity.manufacturer':
      return profile.identity.manufacturer
    case 'identity.model':
      return profile.identity.model
    case 'identity.serialNumber':
      return profile.identity.serialNumber
    case 'identity.yearOfManufacture':
      return profile.identity.yearOfManufacture != null ? String(profile.identity.yearOfManufacture) : ''
    case 'identity.registeredOwner':
      return profile.identity.registeredOwner
    case 'weightBalance.maxTakeoffWeight':
      return formatMeasurement(profile.weightBalance.maxTakeoffWeight, 'kg')
    default:
      return ''
  }
}

export function buildRegistryConflicts(profile: AircraftProfile, snapshot: AircraftRegistrySnapshot) {
  const candidates: Array<{ path: string; label: string; registryValue: string }> = [
    { path: 'identity.manufacturer', label: 'Tillverkare', registryValue: snapshot.manufacturer },
    { path: 'identity.model', label: 'Modell', registryValue: snapshot.model },
    { path: 'identity.serialNumber', label: 'Serienummer', registryValue: snapshot.serialNumber },
    {
      path: 'identity.yearOfManufacture',
      label: 'Tillverkningsår',
      registryValue: snapshot.yearOfManufacture != null ? String(snapshot.yearOfManufacture) : '',
    },
    {
      path: 'identity.registeredOwner',
      label: 'Registrerad ägare',
      registryValue: snapshot.registeredOwners[0] ?? snapshot.registeredOperator ?? '',
    },
    {
      path: 'weightBalance.maxTakeoffWeight',
      label: 'Max startvikt',
      registryValue: snapshot.maxTakeoffWeightKg != null ? `${roundValue(snapshot.maxTakeoffWeightKg, 1)} kg` : '',
    },
  ]

  const conflicts = candidates.flatMap((candidate) => {
    const importValue = readValueAtPath(profile, candidate.path)
    if (!candidate.registryValue || !importValue || candidate.registryValue === importValue) {
      return []
    }

    const existing = profile.conflicts.find((conflict) => conflict.fieldPath === candidate.path)
    return [{
      id: existing?.id ?? randomId('conflict'),
      fieldPath: candidate.path,
      label: candidate.label,
      registryValue: candidate.registryValue,
      importValue,
      selectedSource: existing?.selectedSource ?? null,
      resolvedAt: existing?.resolvedAt ?? null,
    } satisfies AircraftConflict]
  })

  return conflicts
}

export function resolveConflict(
  profile: AircraftProfile,
  conflictId: string,
  choice: AircraftConflictChoice,
) {
  const conflict = profile.conflicts.find((item) => item.id === conflictId)
  if (!conflict) {
    return profile
  }

  const nextProfile = { ...profile }
  const selectedValue = choice === 'registry' ? conflict.registryValue : conflict.importValue

  switch (conflict.fieldPath) {
    case 'identity.manufacturer':
      nextProfile.identity = { ...nextProfile.identity, manufacturer: selectedValue }
      break
    case 'identity.model':
      nextProfile.identity = { ...nextProfile.identity, model: selectedValue }
      break
    case 'identity.serialNumber':
      nextProfile.identity = { ...nextProfile.identity, serialNumber: selectedValue }
      break
    case 'identity.yearOfManufacture':
      nextProfile.identity = {
        ...nextProfile.identity,
        yearOfManufacture: selectedValue ? Number(selectedValue) : null,
      }
      break
    case 'identity.registeredOwner':
      nextProfile.identity = { ...nextProfile.identity, registeredOwner: selectedValue }
      break
    case 'weightBalance.maxTakeoffWeight':
      nextProfile.weightBalance = {
        ...nextProfile.weightBalance,
        maxTakeoffWeight: selectedValue
          ? createCanonicalMeasurement(Number(selectedValue.replace(/[^\d.,-]/g, '').replace(',', '.')), 'kg')
          : null,
      }
      break
    default:
      break
  }

  nextProfile.conflicts = nextProfile.conflicts.map((item) =>
    item.id === conflictId
      ? { ...item, selectedSource: choice, resolvedAt: new Date().toISOString() }
      : item,
  )

  return nextProfile
}

export function toLegacyAircraftProfile(profile: AircraftProfile): LegacyAircraftProfile | null {
  const stations = profile.weightBalance.stations.filter((station) => station.arm)
  const fuelTank = profile.weightBalance.fuelTanks[0]
  const cruiseEntry = profile.performance.cruiseProfiles[0]?.entries[0]

  if (
    !profile.identity.registration ||
    !profile.identity.model ||
    !profile.weightBalance.emptyWeight ||
    !profile.weightBalance.emptyArm ||
    !profile.weightBalance.maxTakeoffWeight ||
    stations.length === 0 ||
    !fuelTank?.arm ||
    !cruiseEntry?.airspeed ||
    !cruiseEntry?.fuelBurn
  ) {
    return null
  }

  return {
    registration: profile.identity.registration,
    typeName: profile.identity.model,
    callsign: profile.identity.registration,
    cruiseTasKt: roundValue(convertValue(cruiseEntry.airspeed.value, cruiseEntry.airspeed.unit, 'kt')),
    fuelBurnLph: roundValue(convertValue(cruiseEntry.fuelBurn.value, cruiseEntry.fuelBurn.unit, 'l')),
    fuelDensityKgPerLiter: 0.72,
    emptyWeightKg: profile.weightBalance.emptyWeight.value,
    emptyArmMm: profile.weightBalance.emptyArm.value,
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      kind: station.kind,
      armMm: station.arm!.value,
      defaultWeightKg: station.defaultWeight?.value ?? null,
      maxWeightKg: station.maxWeight?.value ?? null,
    })),
    fuelStation: {
      id: fuelTank.id,
      name: fuelTank.name || 'Bränsle',
      armMm: fuelTank.arm.value,
    },
    limits: {
      maxTowKg: profile.weightBalance.maxTakeoffWeight.value,
      minArmMm: Math.min(...profile.weightBalance.cgEnvelope.map((point) => point.arm.value), profile.weightBalance.emptyArm.value),
      maxArmMm: Math.max(...profile.weightBalance.cgEnvelope.map((point) => point.arm.value), profile.weightBalance.emptyArm.value),
    },
    performance: {
      takeoff50FtM: 400,
      landing50FtM: 350,
    },
  }
}
