export type MeasurementUnit =
  | 'kg'
  | 'lb'
  | 'l'
  | 'gal_us'
  | 'kt'
  | 'mph'
  | 'm'
  | 'ft'
  | 'mm'
  | 'cm'
  | 'in'

export type MeasurementValue = {
  value: number
  unit: MeasurementUnit
  originalValue: number | null
  originalUnit: MeasurementUnit | null
}

export type AircraftSourceKind =
  | 'manual'
  | 'transportstyrelsen'
  | 'skydemon_import'
  | 'shared_copy'
  | 'community_live'

export type AircraftSourceRecord = {
  id: string
  kind: AircraftSourceKind
  label: string
  importedAt: string
  fileName: string | null
  summary: string | null
}

export type AircraftConflictChoice = 'registry' | 'import' | 'manual'

export type AircraftConflict = {
  id: string
  fieldPath: string
  label: string
  registryValue: string
  importValue: string
  selectedSource: AircraftConflictChoice | null
  resolvedAt: string | null
}

export type AircraftRegistrySnapshot = {
  registration: string
  manufacturer: string
  model: string
  serialNumber: string
  yearOfManufacture: number | null
  maxTakeoffWeightKg: number | null
  registeredOwners: string[]
  registeredOperator: string
  airworthinessExpiresOn: string | null
  registrationDate: string | null
  fetchedAt: string
}

export type AircraftStation = {
  id: string
  name: string
  kind: 'seat' | 'baggage' | 'generic'
  arm: MeasurementValue | null
  defaultWeight: MeasurementValue | null
  maxWeight: MeasurementValue | null
}

export type FuelTank = {
  id: string
  name: string
  arm: MeasurementValue | null
  capacity: MeasurementValue | null
  unusable: MeasurementValue | null
  defaultFuel: MeasurementValue | null
}

export type CgEnvelopePoint = {
  arm: MeasurementValue
  weight: MeasurementValue
}

export type CruiseProfileEntry = {
  altitudeFt: number
  airspeed: MeasurementValue
  fuelBurn: MeasurementValue
}

export type CruiseProfile = {
  id: string
  name: string
  airspeedType: 'tas' | 'ias'
  entries: CruiseProfileEntry[]
}

export type ClimbProfile = {
  indicatedAirspeed: MeasurementValue | null
  rateOfClimbSeaLevelFpm: number | null
  rateOfClimbServiceCeilingFpm: number | null
  fuelBurnSeaLevel: MeasurementValue | null
  fuelBurnServiceCeiling: MeasurementValue | null
}

export type DescentProfile = {
  indicatedAirspeed: MeasurementValue | null
  descentRateFpm: number | null
  fuelBurn: MeasurementValue | null
}

export type UnitPreferences = {
  weight: 'kg' | 'lb'
  fuelVolume: 'l' | 'gal_us'
  arm: 'mm' | 'cm' | 'in'
  tas: 'kt' | 'mph'
  runwayDistance: 'm' | 'ft'
}

export type AircraftProfile = {
  schemaVersion: 2
  profileOrigin: AircraftSourceKind
  displayName: string
  notes: string
  identity: {
    registration: string
    manufacturer: string
    model: string
    variant: string
    serialNumber: string
    yearOfManufacture: number | null
    registeredOwner: string
  }
  registrySnapshot: AircraftRegistrySnapshot | null
  sources: AircraftSourceRecord[]
  conflicts: AircraftConflict[]
  unitPreferences: UnitPreferences
  weightBalance: {
    emptyWeight: MeasurementValue | null
    maxTakeoffWeight: MeasurementValue | null
    emptyArm: MeasurementValue | null
    stations: AircraftStation[]
    fuelTanks: FuelTank[]
    cgEnvelope: CgEnvelopePoint[]
  }
  fuel: {
    fuelType: string
    alternateFuelType: string
    maxFuel: MeasurementValue | null
    taxiFuel: MeasurementValue | null
    landingFuel: MeasurementValue | null
    reserveMinutes: number | null
    contingencyFraction: number | null
    hourlyCostSek: number | null
    hourlyCostIncludesFuel: boolean
  }
  performance: {
    serviceCeilingFt: number | null
    glideAirspeed: MeasurementValue | null
    glideRatio: number | null
    defaultCruiseAltitudeFt: number | null
    climb: ClimbProfile
    descent: DescentProfile
    cruiseProfiles: CruiseProfile[]
  }
  planningDefaults: {
    tasInputUnit: 'kt' | 'mph'
    reserveMinutes: number | null
    defaultCruiseProfileId: string | null
  }
  sharing: {
    mode: 'private' | 'shared_copy' | 'community_live'
    communityName: string | null
  }
}
