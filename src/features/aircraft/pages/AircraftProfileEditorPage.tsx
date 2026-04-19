import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { useAuth } from '../../auth/hooks/useAuth'
import { createAircraftProfile, getAircraftProfileById, updateAircraftProfile } from '../api/aircraftProfilesRepository'
import { lookupAircraftRegistry } from '../api/aircraftRegistry'
import type { AircraftProfile, AircraftStation, FuelTank, MeasurementUnit, MeasurementValue } from '../profileTypes'
import {
  applyRegistrySnapshot,
  convertValue,
  createEmptyAircraftProfile,
  createMeasurement,
  ensureDisplayName,
  formatMeasurement,
  isValidSwedishRegistration,
  normalizeRegistration,
  roundValue,
  sanitizeAircraftProfile,
} from '../profileUtils'
import { detectSkyDemonImportUnits, inspectSkyDemonImportSamples, parseSkyDemonAircraftXml, type SkyDemonImportSamples, type SkyDemonImportUnits } from '../skydemon'
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

function createCruiseProfileEntry() {
  return {
    altitudeFt: 0,
    airspeed: createMeasurement(0, 'kt', 'kt'),
    fuelBurn: createMeasurement(0, 'l', 'l'),
  }
}

function createCruiseProfile() {
  return {
    id: `cruise-${crypto.randomUUID()}`,
    name: 'Ny cruiseprofil',
    airspeedType: 'tas' as const,
    entries: [createCruiseProfileEntry()],
  }
}

function createCgEnvelopePoint() {
  return {
    arm: createMeasurement(0, 'mm', 'mm'),
    weight: createMeasurement(0, 'kg', 'kg'),
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

function createOptionalNumber(rawValue: string) {
  const normalized = rawValue.replace(',', '.').trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

type PendingImport = {
  fileName: string
  xmlText: string
  detectedUnits: SkyDemonImportUnits
  selectedUnits: SkyDemonImportUnits
  samples: SkyDemonImportSamples
}

type ImportConflictChoice = 'current' | 'import'

type ImportConflict = {
  id: string
  label: string
  currentValue: string
  importValue: string
  selectedChoice: ImportConflictChoice | null
  applyCurrent: (target: AircraftProfile, current: AircraftProfile) => AircraftProfile
}

type PendingImportConflicts = {
  sourceLabel: string
  incomingLabel: string
  currentProfile: AircraftProfile
  importedProfile: AircraftProfile
  conflicts: ImportConflict[]
}

function hasMeaningfulValue(value: string) {
  return value.trim().length > 0
}

function normalizeConflictValue(value: string) {
  return value.trim()
}

function summarizeMeasurement(value: MeasurementValue | null, preferredUnit?: MeasurementUnit) {
  return value ? formatMeasurement(value, preferredUnit) : ''
}

function formatUnitName(unit: 'kg' | 'lb' | 'l' | 'gal_us' | 'mm' | 'cm' | 'in') {
  switch (unit) {
    case 'gal_us':
      return 'US gal'
    default:
      return unit
  }
}

function formatImportPreview(value: number | null, fromUnit: MeasurementUnit, toUnit: MeasurementUnit) {
  if (value == null) {
    return 'Saknas i filen'
  }

  const converted = roundValue(convertValue(value, fromUnit, toUnit), toUnit === 'mm' ? 0 : 1)
  return `${roundValue(value, fromUnit === 'mm' ? 0 : 1)} ${fromUnit} -> ${converted} ${toUnit}`
}

function buildCgEnvelopePolyline(profile: AircraftProfile) {
  const points = profile.weightBalance.cgEnvelope
  if (points.length === 0) {
    return null
  }

  const arms = points.map((point) => point.arm.value)
  const weights = points.map((point) => point.weight.value)
  const stationArms = profile.weightBalance.stations
    .filter((station) => station.arm && station.name.trim())
    .map((station) => ({ name: station.name.trim(), arm: station.arm!.value, kind: 'station' as const }))
  const fuelArms = profile.weightBalance.fuelTanks
    .filter((tank) => tank.arm && tank.name.trim())
    .map((tank) => ({ name: tank.name.trim(), arm: tank.arm!.value, kind: 'fuel' as const }))
  const referenceMarkers = [...stationArms, ...fuelArms]
  const minArm = Math.min(...arms, ...(referenceMarkers.map((marker) => marker.arm)))
  const maxArm = Math.max(...arms, ...(referenceMarkers.map((marker) => marker.arm)))
  const minWeight = Math.min(...weights)
  const maxWeight = Math.max(...weights)
  const xMin = minArm - 20
  const xMax = maxArm + 20
  const yMin = Math.max(0, minWeight - 20)
  const yMax = maxWeight + 20
  const armSpan = Math.max(1, xMax - xMin)
  const weightSpan = Math.max(1, yMax - yMin)
  const chartLeft = 72
  const chartRight = 500
  const chartTop = 28
  const chartBottom = 212
  const chartWidth = chartRight - chartLeft
  const chartHeight = chartBottom - chartTop

  const xForArm = (arm: number) => chartLeft + ((arm - xMin) / armSpan) * chartWidth
  const yForWeight = (weight: number) => chartBottom - ((weight - yMin) / weightSpan) * chartHeight

  const mappedPoints = points.map((point) => ({
    x: roundValue(xForArm(point.arm.value), 1),
    y: roundValue(yForWeight(point.weight.value), 1),
  }))
  const mapped = mappedPoints.map((point) => `${point.x},${point.y}`)
  const xTicks = Array.from({ length: 5 }, (_, index) => {
    const value = xMin + (armSpan / 4) * index
    return {
      value: roundValue(value, 0),
      x: roundValue(xForArm(value), 1),
    }
  })
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = yMin + (weightSpan / 4) * index
    return {
      value: roundValue(value, 1),
      y: roundValue(yForWeight(value), 1),
    }
  })
  const referenceMarkerPositions = referenceMarkers
    .map((marker) => ({
      ...marker,
      x: roundValue(xForArm(marker.arm), 1),
    }))
    .sort((left, right) => left.arm - right.arm || left.name.localeCompare(right.name, 'sv'))
    .map((marker, _index, allMarkers) => {
      const sameArmMarkers = allMarkers.filter((candidate) => Math.abs(candidate.arm - marker.arm) < 0.5)
      const stackIndex = sameArmMarkers.findIndex((candidate) => candidate.name === marker.name && candidate.kind === marker.kind)
      return {
        ...marker,
        stackIndex,
      }
    })

  return {
    polyline: mapped.join(' '),
    points: mappedPoints,
    minArm: xMin,
    maxArm: xMax,
    minWeight: yMin,
    maxWeight: yMax,
    xTicks,
    yTicks,
    referenceMarkerPositions,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
  }
}

function hasStationMeasurementData(station: AircraftStation) {
  return Boolean(station.arm || station.defaultWeight || station.maxWeight)
}

function hasFuelTankMeasurementData(tank: FuelTank) {
  return Boolean(tank.arm || tank.capacity || tank.unusable || tank.defaultFuel)
}

function summarizeStations(profile: AircraftProfile) {
  const stations = profile.weightBalance.stations.filter(hasStationMeasurementData)
  if (stations.length === 0) {
    return ''
  }

  return `${stations.length} stationer: ${stations.map((station) => station.name || 'Namnlös').slice(0, 4).join(', ')}`
}

function summarizeFuelTanks(profile: AircraftProfile) {
  const tanks = profile.weightBalance.fuelTanks.filter(hasFuelTankMeasurementData)
  if (tanks.length === 0) {
    return ''
  }

  return `${tanks.length} tankar: ${tanks.map((tank) => tank.name || 'Namnlös').slice(0, 4).join(', ')}`
}

function summarizeCgEnvelope(profile: AircraftProfile) {
  return profile.weightBalance.cgEnvelope.length > 0 ? `${profile.weightBalance.cgEnvelope.length} envelope-punkter` : ''
}

function summarizeCruiseProfiles(profile: AircraftProfile) {
  return profile.performance.cruiseProfiles.length > 0
    ? `${profile.performance.cruiseProfiles.length} cruiseprofiler: ${profile.performance.cruiseProfiles.map((item) => item.name).slice(0, 4).join(', ')}`
    : ''
}

function createImportConflicts(current: AircraftProfile, imported: AircraftProfile): ImportConflict[] {
  const candidates: Array<Omit<ImportConflict, 'id' | 'currentValue' | 'importValue' | 'selectedChoice'> & {
    read: (profile: AircraftProfile) => string
  }> = [
    { label: 'Profilnamn', read: (profile) => profile.displayName.trim(), applyCurrent: (target, source) => ({ ...target, displayName: source.displayName }) },
    { label: 'Anteckningar', read: (profile) => profile.notes.trim(), applyCurrent: (target, source) => ({ ...target, notes: source.notes }) },
    { label: 'Registrering', read: (profile) => profile.identity.registration.trim(), applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, registration: source.identity.registration } }) },
    { label: 'Tillverkare', read: (profile) => profile.identity.manufacturer.trim(), applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, manufacturer: source.identity.manufacturer } }) },
    { label: 'Modell', read: (profile) => profile.identity.model.trim(), applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, model: source.identity.model } }) },
    { label: 'Variant', read: (profile) => profile.identity.variant.trim(), applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, variant: source.identity.variant } }) },
    { label: 'Serienummer', read: (profile) => profile.identity.serialNumber.trim(), applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, serialNumber: source.identity.serialNumber } }) },
    {
      label: 'Tillverkningsår',
      read: (profile) => profile.identity.yearOfManufacture != null ? String(profile.identity.yearOfManufacture) : '',
      applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, yearOfManufacture: source.identity.yearOfManufacture } }),
    },
    { label: 'Registrerad ägare', read: (profile) => profile.identity.registeredOwner.trim(), applyCurrent: (target, source) => ({ ...target, identity: { ...target.identity, registeredOwner: source.identity.registeredOwner } }) },
    { label: 'Viktenhet', read: (profile) => profile.unitPreferences.weight, applyCurrent: (target, source) => ({ ...target, unitPreferences: { ...target.unitPreferences, weight: source.unitPreferences.weight } }) },
    { label: 'Bränsleenhet', read: (profile) => profile.unitPreferences.fuelVolume, applyCurrent: (target, source) => ({ ...target, unitPreferences: { ...target.unitPreferences, fuelVolume: source.unitPreferences.fuelVolume } }) },
    { label: 'Armenhet', read: (profile) => profile.unitPreferences.arm, applyCurrent: (target, source) => ({ ...target, unitPreferences: { ...target.unitPreferences, arm: source.unitPreferences.arm } }) },
    { label: 'TAS-enhet', read: (profile) => profile.planningDefaults.tasInputUnit, applyCurrent: (target, source) => ({ ...target, planningDefaults: { ...target.planningDefaults, tasInputUnit: source.planningDefaults.tasInputUnit }, unitPreferences: { ...target.unitPreferences, tas: source.unitPreferences.tas } }) },
    { label: 'Tomvikt', read: (profile) => summarizeMeasurement(profile.weightBalance.emptyWeight, profile.unitPreferences.weight), applyCurrent: (target, source) => ({ ...target, weightBalance: { ...target.weightBalance, emptyWeight: source.weightBalance.emptyWeight } }) },
    { label: 'Max startvikt', read: (profile) => summarizeMeasurement(profile.weightBalance.maxTakeoffWeight, profile.unitPreferences.weight), applyCurrent: (target, source) => ({ ...target, weightBalance: { ...target.weightBalance, maxTakeoffWeight: source.weightBalance.maxTakeoffWeight } }) },
    { label: 'Tom arm', read: (profile) => summarizeMeasurement(profile.weightBalance.emptyArm, profile.unitPreferences.arm), applyCurrent: (target, source) => ({ ...target, weightBalance: { ...target.weightBalance, emptyArm: source.weightBalance.emptyArm } }) },
    { label: 'Stationer', read: summarizeStations, applyCurrent: (target, source) => ({ ...target, weightBalance: { ...target.weightBalance, stations: source.weightBalance.stations } }) },
    { label: 'Bränsletankar', read: summarizeFuelTanks, applyCurrent: (target, source) => ({ ...target, weightBalance: { ...target.weightBalance, fuelTanks: source.weightBalance.fuelTanks } }) },
    { label: 'CG-kuvert', read: summarizeCgEnvelope, applyCurrent: (target, source) => ({ ...target, weightBalance: { ...target.weightBalance, cgEnvelope: source.weightBalance.cgEnvelope } }) },
    { label: 'Bränsletyp', read: (profile) => profile.fuel.fuelType.trim(), applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, fuelType: source.fuel.fuelType } }) },
    { label: 'Alternativ bränsletyp', read: (profile) => profile.fuel.alternateFuelType.trim(), applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, alternateFuelType: source.fuel.alternateFuelType } }) },
    { label: 'Max bränsle', read: (profile) => summarizeMeasurement(profile.fuel.maxFuel, profile.unitPreferences.fuelVolume), applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, maxFuel: source.fuel.maxFuel } }) },
    { label: 'Taxi fuel', read: (profile) => summarizeMeasurement(profile.fuel.taxiFuel, profile.unitPreferences.fuelVolume), applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, taxiFuel: source.fuel.taxiFuel } }) },
    { label: 'Landing fuel', read: (profile) => summarizeMeasurement(profile.fuel.landingFuel, profile.unitPreferences.fuelVolume), applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, landingFuel: source.fuel.landingFuel } }) },
    {
      label: 'Reserv minuter',
      read: (profile) => profile.fuel.reserveMinutes != null ? String(profile.fuel.reserveMinutes) : '',
      applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, reserveMinutes: source.fuel.reserveMinutes }, planningDefaults: { ...target.planningDefaults, reserveMinutes: source.planningDefaults.reserveMinutes } }),
    },
    {
      label: 'Contingency',
      read: (profile) => profile.fuel.contingencyFraction != null ? String(profile.fuel.contingencyFraction) : '',
      applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, contingencyFraction: source.fuel.contingencyFraction } }),
    },
    {
      label: 'Timkostnad',
      read: (profile) => profile.fuel.hourlyCostSek != null ? String(profile.fuel.hourlyCostSek) : '',
      applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, hourlyCostSek: source.fuel.hourlyCostSek } }),
    },
    {
      label: 'Timkostnad inkluderar bränsle',
      read: (profile) => profile.fuel.hourlyCostIncludesFuel ? 'Ja' : '',
      applyCurrent: (target, source) => ({ ...target, fuel: { ...target.fuel, hourlyCostIncludesFuel: source.fuel.hourlyCostIncludesFuel } }),
    },
    {
      label: 'Service ceiling',
      read: (profile) => profile.performance.serviceCeilingFt != null ? `${profile.performance.serviceCeilingFt} ft` : '',
      applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, serviceCeilingFt: source.performance.serviceCeilingFt } }),
    },
    { label: 'Glidefart', read: (profile) => summarizeMeasurement(profile.performance.glideAirspeed, profile.planningDefaults.tasInputUnit), applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, glideAirspeed: source.performance.glideAirspeed } }) },
    {
      label: 'Glide ratio',
      read: (profile) => profile.performance.glideRatio != null ? String(profile.performance.glideRatio) : '',
      applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, glideRatio: source.performance.glideRatio } }),
    },
    {
      label: 'Standard cruisehöjd',
      read: (profile) => profile.performance.defaultCruiseAltitudeFt != null ? `${profile.performance.defaultCruiseAltitudeFt} ft` : '',
      applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, defaultCruiseAltitudeFt: source.performance.defaultCruiseAltitudeFt } }),
    },
    { label: 'Climbfart', read: (profile) => summarizeMeasurement(profile.performance.climb.indicatedAirspeed, profile.planningDefaults.tasInputUnit), applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, climb: { ...target.performance.climb, indicatedAirspeed: source.performance.climb.indicatedAirspeed } } }) },
    {
      label: 'Climb ROC SL',
      read: (profile) => profile.performance.climb.rateOfClimbSeaLevelFpm != null ? `${profile.performance.climb.rateOfClimbSeaLevelFpm} fpm` : '',
      applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, climb: { ...target.performance.climb, rateOfClimbSeaLevelFpm: source.performance.climb.rateOfClimbSeaLevelFpm } } }),
    },
    {
      label: 'Climb ROC SC',
      read: (profile) => profile.performance.climb.rateOfClimbServiceCeilingFpm != null ? `${profile.performance.climb.rateOfClimbServiceCeilingFpm} fpm` : '',
      applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, climb: { ...target.performance.climb, rateOfClimbServiceCeilingFpm: source.performance.climb.rateOfClimbServiceCeilingFpm } } }),
    },
    { label: 'Climb fuel SL', read: (profile) => summarizeMeasurement(profile.performance.climb.fuelBurnSeaLevel, profile.unitPreferences.fuelVolume), applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, climb: { ...target.performance.climb, fuelBurnSeaLevel: source.performance.climb.fuelBurnSeaLevel } } }) },
    { label: 'Climb fuel SC', read: (profile) => summarizeMeasurement(profile.performance.climb.fuelBurnServiceCeiling, profile.unitPreferences.fuelVolume), applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, climb: { ...target.performance.climb, fuelBurnServiceCeiling: source.performance.climb.fuelBurnServiceCeiling } } }) },
    { label: 'Descentfart', read: (profile) => summarizeMeasurement(profile.performance.descent.indicatedAirspeed, profile.planningDefaults.tasInputUnit), applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, descent: { ...target.performance.descent, indicatedAirspeed: source.performance.descent.indicatedAirspeed } } }) },
    {
      label: 'Descent rate',
      read: (profile) => profile.performance.descent.descentRateFpm != null ? `${profile.performance.descent.descentRateFpm} fpm` : '',
      applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, descent: { ...target.performance.descent, descentRateFpm: source.performance.descent.descentRateFpm } } }),
    },
    { label: 'Descent fuel', read: (profile) => summarizeMeasurement(profile.performance.descent.fuelBurn, profile.unitPreferences.fuelVolume), applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, descent: { ...target.performance.descent, fuelBurn: source.performance.descent.fuelBurn } } }) },
    { label: 'Cruiseprofiler', read: summarizeCruiseProfiles, applyCurrent: (target, source) => ({ ...target, performance: { ...target.performance, cruiseProfiles: source.performance.cruiseProfiles } }) },
  ]

  return candidates.flatMap((candidate) => {
    const currentValue = candidate.read(current)
    if (!hasMeaningfulValue(currentValue)) {
      return []
    }

    const importValue = candidate.read(imported)
    if (normalizeConflictValue(currentValue) === normalizeConflictValue(importValue)) {
      return []
    }

    return [{
      id: crypto.randomUUID(),
      label: candidate.label,
      currentValue,
      importValue,
      selectedChoice: null,
      applyCurrent: candidate.applyCurrent,
    } satisfies ImportConflict]
  })
}

function mergeImportedProfile(current: AircraftProfile, imported: AircraftProfile, conflicts: ImportConflict[]) {
  let nextProfile: AircraftProfile = {
    ...imported,
    sharing: current.sharing,
    conflicts: [],
  }

  for (const conflict of conflicts) {
    if (conflict.selectedChoice === 'current') {
      nextProfile = conflict.applyCurrent(nextProfile, current)
    }
  }

  return nextProfile
}

function createRegistryCandidateProfile(profile: AircraftProfile, snapshot: AircraftProfile['registrySnapshot'] extends infer _ ? NonNullable<AircraftProfile['registrySnapshot']> : never): AircraftProfile {
  const nextProfile = applyRegistrySnapshot(profile, snapshot)

  return {
    ...nextProfile,
    identity: {
      ...nextProfile.identity,
      registration: snapshot.registration || nextProfile.identity.registration,
      manufacturer: snapshot.manufacturer || nextProfile.identity.manufacturer,
      model: snapshot.model || nextProfile.identity.model,
      serialNumber: snapshot.serialNumber || nextProfile.identity.serialNumber,
      yearOfManufacture: snapshot.yearOfManufacture ?? nextProfile.identity.yearOfManufacture,
      registeredOwner: snapshot.registeredOwners[0] || snapshot.registeredOperator || nextProfile.identity.registeredOwner,
    },
    weightBalance: {
      ...nextProfile.weightBalance,
      maxTakeoffWeight: snapshot.maxTakeoffWeightKg != null
        ? createMeasurement(snapshot.maxTakeoffWeightKg, 'kg', 'kg')
        : nextProfile.weightBalance.maxTakeoffWeight,
    },
    conflicts: [],
  }
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
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [pendingImportConflicts, setPendingImportConflicts] = useState<PendingImportConflicts | null>(null)
  const [error, setError] = useState('')
  const canLookupRegistry = isValidSwedishRegistration(profile?.identity.registration ?? '')
  const [draggedCruiseProfileId, setDraggedCruiseProfileId] = useState<string | null>(null)
  const [hoveredEnvelopePointIndex, setHoveredEnvelopePointIndex] = useState<number | null>(null)

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
    if (!isValidSwedishRegistration(registration)) {
      setError('Ange en svensk registrering i formatet SE-XXX innan registeruppslag.')
      return
    }

    setLookupLoading(true)
    setError('')

    try {
      const snapshot = await lookupAircraftRegistry(registration)
      const registryCandidate = createRegistryCandidateProfile(profile, snapshot)
      const conflicts = createImportConflicts(profile, registryCandidate)

      if (conflicts.length > 0) {
        setPendingImportConflicts({
          sourceLabel: 'Registerlookup',
          incomingLabel: 'Transportstyrelsen',
          currentProfile: profile,
          importedProfile: registryCandidate,
          conflicts,
        })
        return
      }

      setProfile(registryCandidate)
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte hämta data från Transportstyrelsen.'))
    } finally {
      setLookupLoading(false)
    }
  }

  async function prepareImportedProfile(imported: AircraftProfile) {
    const nextRegistration = normalizeRegistration(imported.identity.registration)

    if (nextRegistration) {
      try {
        const snapshot = await lookupAircraftRegistry(nextRegistration)
        const prefixed = applyRegistrySnapshot(imported, snapshot)
        prefixed.conflicts = []
        return prefixed
      } catch {
        // Importen ska fungera även utan registerträff.
      }
    }

    return {
      ...imported,
      conflicts: [],
    }
  }

  async function handleImport(file: File) {
    setImportLoading(true)
    setError('')

    try {
      const xmlText = await file.text()
      const detectedUnits = detectSkyDemonImportUnits(xmlText)
      const samples = inspectSkyDemonImportSamples(xmlText)
      setPendingImport({
        fileName: file.name,
        xmlText,
        detectedUnits,
        selectedUnits: detectedUnits,
        samples,
      })
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte importera SkyDemon-profilen.'))
    } finally {
      setImportLoading(false)
    }
  }

  async function confirmImport() {
    if (!pendingImport || !profile) {
      return
    }

    setImportLoading(true)
    setError('')

    try {
      const imported = parseSkyDemonAircraftXml(pendingImport.xmlText, pendingImport.fileName, pendingImport.selectedUnits)
      const preparedImport = await prepareImportedProfile(imported)
      const conflicts = createImportConflicts(profile, preparedImport)

      if (conflicts.length > 0) {
        setPendingImportConflicts({
          sourceLabel: 'Import',
          incomingLabel: 'Import',
          currentProfile: profile,
          importedProfile: preparedImport,
          conflicts,
        })
        setPendingImport(null)
        return
      }

      setProfile(preparedImport)
      setPendingImport(null)
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte importera SkyDemon-profilen.'))
    } finally {
      setImportLoading(false)
    }
  }

  function confirmImportConflicts() {
    if (!pendingImportConflicts) {
      return
    }

    if (pendingImportConflicts.conflicts.some((conflict) => conflict.selectedChoice == null)) {
      return
    }

    const merged = mergeImportedProfile(
      pendingImportConflicts.currentProfile,
      pendingImportConflicts.importedProfile,
      pendingImportConflicts.conflicts,
    )

    setProfile(merged)
    setPendingImportConflicts(null)
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

  const cgEnvelopeGraph = buildCgEnvelopePolyline(profile)

  return (
    <section className="app-panel aircraft-editor">
      {pendingImportConflicts && (
        <div className="aircraft-import-dialog" role="dialog" aria-modal="true" aria-labelledby="aircraft-import-conflicts-title">
          <div className="aircraft-import-dialog__backdrop" />
          <div className="app-card aircraft-import-dialog__panel aircraft-import-dialog__panel--wide">
            <div className="aircraft-section__header">
              <div>
                <p className="app-eyebrow">Import</p>
                <h2 id="aircraft-import-conflicts-title">Konflikter att granska</h2>
                <p>{pendingImportConflicts.sourceLabel} är pausad tills du väljer vad som ska behållas för alla fält där nuvarande profil redan innehåller data som skiljer sig från {pendingImportConflicts.incomingLabel.toLowerCase()}.</p>
              </div>
              <div className="resource-list__actions">
                <button type="button" className="button-link" onClick={() => setPendingImportConflicts(null)}>
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={confirmImportConflicts}
                  disabled={pendingImportConflicts.conflicts.some((conflict) => conflict.selectedChoice == null)}
                >
                  Slutför import
                </button>
              </div>
            </div>

            <div className="aircraft-note">
              {pendingImportConflicts.conflicts.filter((conflict) => conflict.selectedChoice == null).length} val kvar innan importen kan slutföras.
            </div>

            <div className="aircraft-conflict-list">
              {pendingImportConflicts.conflicts.map((conflict) => (
                <article key={conflict.id} className="aircraft-conflict">
                  <strong>{conflict.label}</strong>
                  <div>Nuvarande profil: {conflict.currentValue || 'Tomt'}</div>
                  <div>{pendingImportConflicts.incomingLabel}: {conflict.importValue || 'Tomt'}</div>
                  <div className="resource-list__actions">
                    <button
                      type="button"
                      className={conflict.selectedChoice === 'current' ? 'aircraft-choice-button is-selected' : 'aircraft-choice-button'}
                      onClick={() => setPendingImportConflicts({
                        ...pendingImportConflicts,
                        conflicts: pendingImportConflicts.conflicts.map((item) =>
                          item.id === conflict.id
                            ? { ...item, selectedChoice: 'current' }
                            : item,
                        ),
                      })}
                    >
                      Behåll nuvarande
                    </button>
                    <button
                      type="button"
                      className={conflict.selectedChoice === 'import' ? 'aircraft-choice-button is-selected' : 'aircraft-choice-button'}
                      onClick={() => setPendingImportConflicts({
                        ...pendingImportConflicts,
                        conflicts: pendingImportConflicts.conflicts.map((item) =>
                          item.id === conflict.id
                            ? { ...item, selectedChoice: 'import' }
                            : item,
                        ),
                      })}
                    >
                      Använd {pendingImportConflicts.incomingLabel.toLowerCase()}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <div className="aircraft-import-dialog" role="dialog" aria-modal="true" aria-labelledby="aircraft-import-dialog-title">
          <div className="aircraft-import-dialog__backdrop" onClick={() => !importLoading && setPendingImport(null)} />
          <div className="app-card aircraft-import-dialog__panel">
            <div className="aircraft-section__header">
              <div>
                <p className="app-eyebrow">Import</p>
                <h2 id="aircraft-import-dialog-title">Bekräfta enheter för {pendingImport.fileName}</h2>
                <p>Välj hur värdena i filen ska tolkas. Profilen sparas alltid internt som kg, liter och mm även om du väljer andra visningsenheter.</p>
              </div>
              <div className="resource-list__actions">
                <button type="button" className="button-link" onClick={() => setPendingImport(null)} disabled={importLoading}>
                  Avbryt
                </button>
                <button type="button" onClick={() => void confirmImport()} disabled={importLoading}>
                  {importLoading ? 'Importerar...' : 'Importera profil'}
                </button>
              </div>
            </div>

            <div className="aircraft-note">
              Internt format: vikt i <strong>kg</strong>, bränsle i <strong>liter</strong>, arm i <strong>mm</strong>.
            </div>

            {pendingImport.selectedUnits.armUnit !== pendingImport.detectedUnits.armUnit && (
              <div className="aircraft-warning">
                Arm-enheten är ändrad från filens förslag <strong>{formatUnitName(pendingImport.detectedUnits.armUnit)}</strong> till <strong>{formatUnitName(pendingImport.selectedUnits.armUnit)}</strong>.
                Det påverkar tom arm, stationer, tankarmar och envelope-punkter i hela importen.
              </div>
            )}

            <div className="aircraft-fields">
              <label className="aircraft-field">
                <span>Tolka vikt som</span>
                <select
                  value={pendingImport.selectedUnits.weightUnit}
                  onChange={(event) => setPendingImport({
                    ...pendingImport,
                    selectedUnits: { ...pendingImport.selectedUnits, weightUnit: event.target.value as 'kg' | 'lb' },
                  })}
                >
                  <option value="kg">kg</option>
                  <option value="lb">lb</option>
                </select>
                <small>Filens förslag: {formatUnitName(pendingImport.detectedUnits.weightUnit)}</small>
              </label>

              <label className="aircraft-field">
                <span>Tolka bränslevolym som</span>
                <select
                  value={pendingImport.selectedUnits.fuelVolumeUnit}
                  onChange={(event) => setPendingImport({
                    ...pendingImport,
                    selectedUnits: { ...pendingImport.selectedUnits, fuelVolumeUnit: event.target.value as 'l' | 'gal_us' },
                  })}
                >
                  <option value="l">liter</option>
                  <option value="gal_us">US gal</option>
                </select>
                <small>Filens förslag: {formatUnitName(pendingImport.detectedUnits.fuelVolumeUnit)}</small>
              </label>

              <label className="aircraft-field">
                <span>Tolka arm som</span>
                <select
                  value={pendingImport.selectedUnits.armUnit}
                  onChange={(event) => setPendingImport({
                    ...pendingImport,
                    selectedUnits: { ...pendingImport.selectedUnits, armUnit: event.target.value as 'mm' | 'cm' | 'in' },
                  })}
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="in">in</option>
                </select>
                <small>Filens förslag: {formatUnitName(pendingImport.detectedUnits.armUnit)}</small>
              </label>
            </div>

            <div className="aircraft-import-preview">
              <strong>Förhandsvisning av tolkning</strong>
              <div>Tom arm: {formatImportPreview(pendingImport.samples.emptyArm, pendingImport.selectedUnits.armUnit, 'mm')}</div>
              <div>Första stationens arm: {formatImportPreview(pendingImport.samples.firstStationArm, pendingImport.selectedUnits.armUnit, 'mm')}</div>
              <div>Första tankens arm: {formatImportPreview(pendingImport.samples.firstFuelTankArm, pendingImport.selectedUnits.armUnit, 'mm')}</div>
              <div>Tomvikt: {formatImportPreview(pendingImport.samples.emptyWeight, pendingImport.selectedUnits.weightUnit, 'kg')}</div>
              <div>Max startvikt: {formatImportPreview(pendingImport.samples.maxTakeoffWeight, pendingImport.selectedUnits.weightUnit, 'kg')}</div>
              <div>Max bränsle: {formatImportPreview(pendingImport.samples.maxFuel, pendingImport.selectedUnits.fuelVolumeUnit, 'l')}</div>
            </div>
          </div>
        </div>
      )}

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
              <button
                type="button"
                onClick={handleLookup}
                disabled={lookupLoading || !canLookupRegistry}
                title={canLookupRegistry ? undefined : 'Ange en svensk registrering i formatet SE-XXX'}
              >
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
                placeholder="SE-XXX"
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
              <p>Välj hur värden visas och redigeras. Alla värden sparas internt konsekvent som kg, liter och mm.</p>
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
              <span>Visa och redigera vikt som</span>
              <select
                value={profile.unitPreferences.weight}
                onChange={(event) => setProfile({ ...profile, unitPreferences: { ...profile.unitPreferences, weight: event.target.value as 'kg' | 'lb' } })}
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </label>
            <label className="aircraft-field">
              <span>Visa och redigera bränsle som</span>
              <select
                value={profile.unitPreferences.fuelVolume}
                onChange={(event) => setProfile({ ...profile, unitPreferences: { ...profile.unitPreferences, fuelVolume: event.target.value as 'l' | 'gal_us' } })}
              >
                <option value="l">liter</option>
                <option value="gal_us">US gal</option>
              </select>
            </label>
            <label className="aircraft-field">
              <span>Visa och redigera arm som</span>
              <select
                value={profile.unitPreferences.arm}
                onChange={(event) => setProfile({ ...profile, unitPreferences: { ...profile.unitPreferences, arm: event.target.value as 'mm' | 'cm' | 'in' } })}
              >
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="in">in</option>
              </select>
            </label>
          </div>

          <div className="aircraft-unit-preview">
            <div className={`aircraft-unit-chip aircraft-unit-chip--${profile.planningDefaults.tasInputUnit === 'mph' ? 'imperial' : 'metric'}`}>
              TAS-kolumn i färdplan: {profile.planningDefaults.tasInputUnit}
            </div>
            <div className="aircraft-unit-preview__internal">Internt: kg · liter · mm</div>
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
              <h3>Tyngdpunktsenvelope</h3>
              <button
                type="button"
                onClick={() => setProfile({
                  ...profile,
                  weightBalance: {
                    ...profile.weightBalance,
                    cgEnvelope: [...profile.weightBalance.cgEnvelope, createCgEnvelopePoint()],
                  },
                })}
              >
                Lägg till punkt
              </button>
            </div>

            {cgEnvelopeGraph ? (
              <div className="aircraft-envelope-graph">
                {hoveredEnvelopePointIndex != null && cgEnvelopeGraph.points[hoveredEnvelopePointIndex] && profile.weightBalance.cgEnvelope[hoveredEnvelopePointIndex] && (
                  <div
                    className="aircraft-envelope-graph__tooltip"
                    style={{
                      left: `${(cgEnvelopeGraph.points[hoveredEnvelopePointIndex].x / 560) * 100}%`,
                      top: `${(cgEnvelopeGraph.points[hoveredEnvelopePointIndex].y / 320) * 100}%`,
                    }}
                  >
                    <strong>Punkt {hoveredEnvelopePointIndex + 1}</strong>
                    <span>{formatMeasurement(profile.weightBalance.cgEnvelope[hoveredEnvelopePointIndex].arm, profile.unitPreferences.arm)}</span>
                    <span>{formatMeasurement(profile.weightBalance.cgEnvelope[hoveredEnvelopePointIndex].weight, profile.unitPreferences.weight)}</span>
                  </div>
                )}
                <svg viewBox="0 0 560 320" aria-label="Tyngdpunktsenvelope">
                  <rect
                    x={cgEnvelopeGraph.chartLeft}
                    y={cgEnvelopeGraph.chartTop}
                    width={cgEnvelopeGraph.chartRight - cgEnvelopeGraph.chartLeft}
                    height={cgEnvelopeGraph.chartBottom - cgEnvelopeGraph.chartTop}
                    className="aircraft-envelope-graph__frame"
                  />
                  {cgEnvelopeGraph.yTicks.map((tick) => (
                    <g key={`y-${tick.y}`}>
                      <line
                        x1={cgEnvelopeGraph.chartLeft}
                        y1={tick.y}
                        x2={cgEnvelopeGraph.chartRight}
                        y2={tick.y}
                        className="aircraft-envelope-graph__grid"
                      />
                      <text x={cgEnvelopeGraph.chartLeft - 8} y={tick.y + 4} textAnchor="end" className="aircraft-envelope-graph__label">
                        {tick.value}
                      </text>
                    </g>
                  ))}
                  {cgEnvelopeGraph.xTicks.map((tick) => (
                    <g key={`x-${tick.x}`}>
                      <line
                        x1={tick.x}
                        y1={cgEnvelopeGraph.chartTop}
                        x2={tick.x}
                        y2={cgEnvelopeGraph.chartBottom}
                        className="aircraft-envelope-graph__grid"
                      />
                      <text x={tick.x} y={cgEnvelopeGraph.chartBottom + 18} textAnchor="middle" className="aircraft-envelope-graph__label">
                        {tick.value}
                      </text>
                    </g>
                  ))}
                  <polyline
                    fill="rgba(12, 93, 127, 0.14)"
                    stroke="#0c5d7f"
                    strokeWidth="2.5"
                    points={cgEnvelopeGraph.polyline}
                  />
                  {cgEnvelopeGraph.points.map((point, index) => (
                    <circle
                      key={`point-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r="5"
                      className="aircraft-envelope-graph__point"
                      onMouseEnter={() => setHoveredEnvelopePointIndex(index)}
                      onMouseLeave={() => setHoveredEnvelopePointIndex((current) => current === index ? null : current)}
                    />
                  ))}
                  {cgEnvelopeGraph.referenceMarkerPositions.map((marker) => (
                    <g key={`${marker.kind}-${marker.name}`}>
                      <line
                        x1={marker.x}
                        y1={cgEnvelopeGraph.chartBottom}
                        x2={marker.x}
                        y2={cgEnvelopeGraph.chartBottom + 8}
                        className={marker.kind === 'fuel' ? 'aircraft-envelope-graph__fuel-line' : 'aircraft-envelope-graph__station-line'}
                      />
                      <text
                        x={marker.x}
                        y={cgEnvelopeGraph.chartBottom + 42 + marker.stackIndex * 16}
                        textAnchor="end"
                        transform={`rotate(-32 ${marker.x} ${cgEnvelopeGraph.chartBottom + 42 + marker.stackIndex * 16})`}
                        className={marker.kind === 'fuel' ? 'aircraft-envelope-graph__fuel-label' : 'aircraft-envelope-graph__station-label'}
                      >
                        {marker.name}
                      </text>
                    </g>
                  ))}
                  <text
                    x="20"
                    y={(cgEnvelopeGraph.chartTop + cgEnvelopeGraph.chartBottom) / 2}
                    textAnchor="middle"
                    transform={`rotate(-90 20 ${(cgEnvelopeGraph.chartTop + cgEnvelopeGraph.chartBottom) / 2})`}
                    className="aircraft-envelope-graph__axis-title"
                  >
                    Vikt
                  </text>
                  <text
                    x={(cgEnvelopeGraph.chartLeft + cgEnvelopeGraph.chartRight) / 2}
                    y="308"
                    textAnchor="middle"
                    className="aircraft-envelope-graph__axis-title"
                  >
                    Arm
                  </text>
                </svg>
              </div>
            ) : (
              <div className="aircraft-note">Inga envelope-punkter ännu.</div>
            )}

            <div className="aircraft-list">
              {profile.weightBalance.cgEnvelope.map((point, index) => (
                <article className="aircraft-list__row aircraft-list__row--compact aircraft-list__row--envelope" key={`cg-${index}`}>
                  <MeasurementField
                    label="Arm"
                    value={point.arm}
                    sourceUnit={profile.unitPreferences.arm}
                    canonicalUnit="mm"
                    unitAccent={profile.unitPreferences.arm === 'in' ? 'imperial' : 'metric'}
                    onChange={(nextValue) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        cgEnvelope: profile.weightBalance.cgEnvelope.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, arm: nextValue ?? createMeasurement(0, 'mm', 'mm') }
                            : item,
                        ),
                      },
                    })}
                  />
                  <MeasurementField
                    label="Vikt"
                    value={point.weight}
                    sourceUnit={profile.unitPreferences.weight}
                    canonicalUnit="kg"
                    unitAccent={profile.unitPreferences.weight === 'lb' ? 'imperial' : 'metric'}
                    onChange={(nextValue) => setProfile({
                      ...profile,
                      weightBalance: {
                        ...profile.weightBalance,
                        cgEnvelope: profile.weightBalance.cgEnvelope.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, weight: nextValue ?? createMeasurement(0, 'kg', 'kg') }
                            : item,
                        ),
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
                        cgEnvelope: profile.weightBalance.cgEnvelope.filter((_, itemIndex) => itemIndex !== index),
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

          <div className="aircraft-subsection">
            <div className="aircraft-subsection__header">
              <h3>Climbprofil</h3>
            </div>
            <div className="aircraft-fields">
              <MeasurementField
                label="Climbfart"
                value={profile.performance.climb.indicatedAirspeed}
                sourceUnit={profile.planningDefaults.tasInputUnit}
                canonicalUnit="kt"
                unitAccent={profile.planningDefaults.tasInputUnit === 'mph' ? 'imperial' : 'metric'}
                onChange={(nextValue) => setProfile({ ...profile, performance: { ...profile.performance, climb: { ...profile.performance.climb, indicatedAirspeed: nextValue } } })}
              />
              <label className="aircraft-field">
                <span>ROC vid havsnivå (fpm)</span>
                <input
                  value={profile.performance.climb.rateOfClimbSeaLevelFpm ?? ''}
                  inputMode="numeric"
                  onChange={(event) => setProfile({ ...profile, performance: { ...profile.performance, climb: { ...profile.performance.climb, rateOfClimbSeaLevelFpm: createOptionalNumber(event.target.value) } } })}
                />
              </label>
              <label className="aircraft-field">
                <span>ROC vid service ceiling (fpm)</span>
                <input
                  value={profile.performance.climb.rateOfClimbServiceCeilingFpm ?? ''}
                  inputMode="numeric"
                  onChange={(event) => setProfile({ ...profile, performance: { ...profile.performance, climb: { ...profile.performance.climb, rateOfClimbServiceCeilingFpm: createOptionalNumber(event.target.value) } } })}
                />
              </label>
              <MeasurementField
                label="Climb fuel SL"
                value={profile.performance.climb.fuelBurnSeaLevel}
                sourceUnit={profile.unitPreferences.fuelVolume}
                canonicalUnit="l"
                unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
                onChange={(nextValue) => setProfile({ ...profile, performance: { ...profile.performance, climb: { ...profile.performance.climb, fuelBurnSeaLevel: nextValue } } })}
              />
              <MeasurementField
                label="Climb fuel SC"
                value={profile.performance.climb.fuelBurnServiceCeiling}
                sourceUnit={profile.unitPreferences.fuelVolume}
                canonicalUnit="l"
                unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
                onChange={(nextValue) => setProfile({ ...profile, performance: { ...profile.performance, climb: { ...profile.performance.climb, fuelBurnServiceCeiling: nextValue } } })}
              />
            </div>
          </div>

          <div className="aircraft-subsection">
            <div className="aircraft-subsection__header">
              <h3>Descentprofil</h3>
            </div>
            <div className="aircraft-fields">
              <MeasurementField
                label="Descentfart"
                value={profile.performance.descent.indicatedAirspeed}
                sourceUnit={profile.planningDefaults.tasInputUnit}
                canonicalUnit="kt"
                unitAccent={profile.planningDefaults.tasInputUnit === 'mph' ? 'imperial' : 'metric'}
                onChange={(nextValue) => setProfile({ ...profile, performance: { ...profile.performance, descent: { ...profile.performance.descent, indicatedAirspeed: nextValue } } })}
              />
              <label className="aircraft-field">
                <span>Descent rate (fpm)</span>
                <input
                  value={profile.performance.descent.descentRateFpm ?? ''}
                  inputMode="numeric"
                  onChange={(event) => setProfile({ ...profile, performance: { ...profile.performance, descent: { ...profile.performance.descent, descentRateFpm: createOptionalNumber(event.target.value) } } })}
                />
              </label>
              <MeasurementField
                label="Descent fuel"
                value={profile.performance.descent.fuelBurn}
                sourceUnit={profile.unitPreferences.fuelVolume}
                canonicalUnit="l"
                unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
                onChange={(nextValue) => setProfile({ ...profile, performance: { ...profile.performance, descent: { ...profile.performance.descent, fuelBurn: nextValue } } })}
              />
            </div>
          </div>

          <div className="aircraft-subsection">
            <div className="aircraft-subsection__header">
              <div>
                <h3>Cruiseprofiler</h3>
                <p>Dra sektionerna för att byta ordning.</p>
              </div>
              <button
                type="button"
                onClick={() => setProfile({
                  ...profile,
                  performance: {
                    ...profile.performance,
                    cruiseProfiles: [...profile.performance.cruiseProfiles, createCruiseProfile()],
                  },
                })}
              >
                Lägg till cruiseprofil
              </button>
            </div>
            <div className="aircraft-cruise-list">
              {profile.performance.cruiseProfiles.map((cruiseProfile) => (
                <article
                  key={cruiseProfile.id}
                  className={`aircraft-cruise-card${draggedCruiseProfileId === cruiseProfile.id ? ' is-dragging' : ''}`}
                  draggable
                  onDragStart={() => setDraggedCruiseProfileId(cruiseProfile.id)}
                  onDragEnd={() => setDraggedCruiseProfileId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (!draggedCruiseProfileId || draggedCruiseProfileId === cruiseProfile.id) {
                      return
                    }

                    const draggedProfile = profile.performance.cruiseProfiles.find((item) => item.id === draggedCruiseProfileId)
                    if (!draggedProfile) {
                      return
                    }

                    const withoutDragged = profile.performance.cruiseProfiles.filter((item) => item.id !== draggedCruiseProfileId)
                    const targetIndex = withoutDragged.findIndex((item) => item.id === cruiseProfile.id)
                    withoutDragged.splice(targetIndex, 0, draggedProfile)

                    setProfile({
                      ...profile,
                      performance: {
                        ...profile.performance,
                        cruiseProfiles: withoutDragged,
                      },
                    })
                    setDraggedCruiseProfileId(null)
                  }}
                >
                  <div className="aircraft-cruise-card__header">
                    <strong>Drag</strong>
                    <button
                      type="button"
                      className="button-link button-link--danger"
                      onClick={() => setProfile({
                        ...profile,
                        performance: {
                          ...profile.performance,
                          cruiseProfiles: profile.performance.cruiseProfiles.filter((item) => item.id !== cruiseProfile.id),
                        },
                      })}
                    >
                      Ta bort
                    </button>
                  </div>

                  <div className="aircraft-fields">
                    <label className="aircraft-field">
                      <span>Namn</span>
                      <input
                        value={cruiseProfile.name}
                        onChange={(event) => setProfile({
                          ...profile,
                          performance: {
                            ...profile.performance,
                            cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                              item.id === cruiseProfile.id ? { ...item, name: event.target.value } : item,
                            ),
                          },
                        })}
                      />
                    </label>
                    <label className="aircraft-field">
                      <span>Farttyp</span>
                      <select
                        value={cruiseProfile.airspeedType}
                        onChange={(event) => setProfile({
                          ...profile,
                          performance: {
                            ...profile.performance,
                            cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                              item.id === cruiseProfile.id ? { ...item, airspeedType: event.target.value as 'tas' | 'ias' } : item,
                            ),
                          },
                        })}
                      >
                        <option value="tas">TAS</option>
                        <option value="ias">IAS</option>
                      </select>
                    </label>
                  </div>

                  <div className="aircraft-subsection">
                    <div className="aircraft-subsection__header">
                      <h3>Entries</h3>
                      <button
                        type="button"
                        onClick={() => setProfile({
                          ...profile,
                          performance: {
                            ...profile.performance,
                            cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                              item.id === cruiseProfile.id
                                ? { ...item, entries: [...item.entries, createCruiseProfileEntry()] }
                                : item,
                            ),
                          },
                        })}
                      >
                        Lägg till entry
                      </button>
                    </div>
                    <div className="aircraft-list">
                      {cruiseProfile.entries.map((entry, entryIndex) => (
                        <article key={`${cruiseProfile.id}-${entryIndex}`} className="aircraft-list__row aircraft-list__row--compact">
                          <label className="aircraft-field">
                            <span>Höjd (ft)</span>
                            <input
                              value={entry.altitudeFt}
                              inputMode="numeric"
                              onChange={(event) => setProfile({
                                ...profile,
                                performance: {
                                  ...profile.performance,
                                  cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                                    item.id === cruiseProfile.id
                                      ? {
                                          ...item,
                                          entries: item.entries.map((itemEntry, itemEntryIndex) =>
                                            itemEntryIndex === entryIndex
                                              ? { ...itemEntry, altitudeFt: createOptionalNumber(event.target.value) ?? 0 }
                                              : itemEntry,
                                          ),
                                        }
                                      : item,
                                  ),
                                },
                              })}
                            />
                          </label>
                          <MeasurementField
                            label={cruiseProfile.airspeedType === 'ias' ? 'IAS' : 'TAS'}
                            value={entry.airspeed}
                            sourceUnit={profile.planningDefaults.tasInputUnit}
                            canonicalUnit="kt"
                            unitAccent={profile.planningDefaults.tasInputUnit === 'mph' ? 'imperial' : 'metric'}
                            onChange={(nextValue) => setProfile({
                              ...profile,
                              performance: {
                                ...profile.performance,
                                cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                                  item.id === cruiseProfile.id
                                    ? {
                                        ...item,
                                        entries: item.entries.map((itemEntry, itemEntryIndex) =>
                                          itemEntryIndex === entryIndex
                                            ? { ...itemEntry, airspeed: nextValue ?? createMeasurement(0, 'kt', 'kt') }
                                            : itemEntry,
                                        ),
                                      }
                                    : item,
                                ),
                              },
                            })}
                          />
                          <MeasurementField
                            label="Fuel burn"
                            value={entry.fuelBurn}
                            sourceUnit={profile.unitPreferences.fuelVolume}
                            canonicalUnit="l"
                            unitAccent={profile.unitPreferences.fuelVolume === 'gal_us' ? 'imperial' : 'metric'}
                            onChange={(nextValue) => setProfile({
                              ...profile,
                              performance: {
                                ...profile.performance,
                                cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                                  item.id === cruiseProfile.id
                                    ? {
                                        ...item,
                                        entries: item.entries.map((itemEntry, itemEntryIndex) =>
                                          itemEntryIndex === entryIndex
                                            ? { ...itemEntry, fuelBurn: nextValue ?? createMeasurement(0, 'l', 'l') }
                                            : itemEntry,
                                        ),
                                      }
                                    : item,
                                ),
                              },
                            })}
                          />
                          <button
                            type="button"
                            className="button-link button-link--danger"
                            onClick={() => setProfile({
                              ...profile,
                              performance: {
                                ...profile.performance,
                                cruiseProfiles: profile.performance.cruiseProfiles.map((item) =>
                                  item.id === cruiseProfile.id
                                    ? { ...item, entries: item.entries.filter((_, itemEntryIndex) => itemEntryIndex !== entryIndex) }
                                    : item,
                                ),
                              },
                            })}
                          >
                            Ta bort
                          </button>
                        </article>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

      </div>
    </section>
  )
}
