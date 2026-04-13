import type { AircraftProfile, AircraftStation, FuelTank } from './profileTypes'
import { createEmptyAircraftProfile, createMeasurement, createSourceRecord, normalizeRegistration } from './profileUtils'

function parseNumber(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.replace(',', '.').trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value: string | null) {
  const parsed = parseNumber(value)
  return parsed == null ? null : Math.round(parsed)
}

function parseBoolean(value: string | null) {
  return value?.toLowerCase() === 'true'
}

function mapLoadingPoint(
  node: Element,
  weightUnit: 'kg' | 'lb',
  armUnit: 'mm' | 'in',
): AircraftStation {
  const defaultValue = parseNumber(node.getAttribute('DefaultValue'))
  const maxValue = parseNumber(node.getAttribute('MaximumValue'))
  const leverArm = parseNumber(node.getAttribute('LeverArm'))
  const name = node.getAttribute('Name')?.trim() ?? 'Station'
  const lowerName = name.toLowerCase()

  return {
    id: `station-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    kind: lowerName.includes('bag') ? 'baggage' : lowerName.includes('pilot') || lowerName.includes('passenger') || lowerName.includes('sits') ? 'seat' : 'generic',
    arm: leverArm != null ? createMeasurement(leverArm, armUnit, 'mm') : null,
    defaultWeight: defaultValue != null ? createMeasurement(defaultValue, weightUnit, 'kg') : null,
    maxWeight: maxValue != null ? createMeasurement(maxValue, weightUnit, 'kg') : null,
  }
}

function mapFuelLoadingPoint(
  node: Element,
  volumeUnit: 'l' | 'gal_us',
  armUnit: 'mm' | 'in',
): FuelTank {
  const leverArm = parseNumber(node.getAttribute('LeverArm'))
  const capacity = parseNumber(node.getAttribute('Capacity'))
  const unusable = parseNumber(node.getAttribute('Unusable'))
  const defaultValue = parseNumber(node.getAttribute('DefaultValue'))

  return {
    id: `fuel-${(node.getAttribute('Name') ?? 'fuel').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: node.getAttribute('Name')?.trim() ?? 'Bränsle',
    arm: leverArm != null ? createMeasurement(leverArm, armUnit, 'mm') : null,
    capacity: capacity != null ? createMeasurement(capacity, volumeUnit, 'l') : null,
    unusable: unusable != null ? createMeasurement(unusable, volumeUnit, 'l') : null,
    defaultFuel: defaultValue != null ? createMeasurement(defaultValue, volumeUnit, 'l') : null,
  }
}

export function parseSkyDemonAircraftXml(xmlText: string, fileName: string) {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')
  const aircraft = document.querySelector('Aircraft')

  if (!aircraft) {
    throw new Error('Filen saknar Aircraft-element.')
  }

  if (document.querySelector('parsererror')) {
    throw new Error('Kunde inte läsa SkyDemon-filen som XML.')
  }

  const fuelVolumeUnit = aircraft.getAttribute('FuelMeasurementVolumeType')?.toLowerCase().includes('gallon') ? 'gal_us' : 'l'
  const fuelMassUnit = aircraft.getAttribute('FuelMeasurementMassType')?.toLowerCase().includes('pound') ? 'lb' : 'kg'
  const armUnit = 'in'
  const profile: AircraftProfile = createEmptyAircraftProfile('skydemon_import')
  const registration = normalizeRegistration(aircraft.getAttribute('Registration') ?? aircraft.getAttribute('Name') ?? '')
  const model = aircraft.getAttribute('Type')?.trim() ?? ''

  profile.displayName = aircraft.getAttribute('Name')?.trim() ?? registration
  profile.identity = {
    ...profile.identity,
    registration,
    model,
    registeredOwner: '',
  }
  profile.fuel = {
    ...profile.fuel,
    fuelType: aircraft.getAttribute('FuelType') ?? '',
    alternateFuelType: aircraft.getAttribute('AlternateFuelType') ?? '',
    maxFuel: parseNumber(aircraft.getAttribute('MaxFuel')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('MaxFuel'))!, fuelVolumeUnit, 'l')
      : null,
    taxiFuel: parseNumber(aircraft.getAttribute('TaxiFuel')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('TaxiFuel'))!, fuelVolumeUnit, 'l')
      : null,
    landingFuel: parseNumber(aircraft.getAttribute('LandingFuel')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('LandingFuel'))!, fuelVolumeUnit, 'l')
      : null,
    reserveMinutes: parseInteger(aircraft.getAttribute('HoldingMinutes')),
    contingencyFraction: parseNumber(aircraft.getAttribute('FuelContingency')),
    hourlyCostSek: parseInteger(aircraft.getAttribute('HourlyCost')),
    hourlyCostIncludesFuel: parseBoolean(aircraft.getAttribute('HourlyCostIncludesFuel')),
  }
  profile.unitPreferences = {
    weight: fuelMassUnit,
    fuelVolume: fuelVolumeUnit,
    arm: armUnit,
    tas: 'kt',
    runwayDistance: 'm',
  }
  profile.weightBalance = {
    ...profile.weightBalance,
    emptyWeight: parseNumber(aircraft.getAttribute('EmptyWeight')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('EmptyWeight'))!, fuelMassUnit, 'kg')
      : null,
    maxTakeoffWeight: parseNumber(aircraft.getAttribute('MaximumWeight')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('MaximumWeight'))!, fuelMassUnit, 'kg')
      : null,
    emptyArm: parseNumber(aircraft.getAttribute('EmptyArmLon')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('EmptyArmLon'))!, armUnit, 'mm')
      : null,
    stations: Array.from(aircraft.querySelectorAll('LoadingPoints > LoadingPoint')).map((node) => mapLoadingPoint(node, fuelMassUnit, armUnit)),
    fuelTanks: Array.from(aircraft.querySelectorAll('LoadingPoints > FuelLoadingPoint')).map((node) => mapFuelLoadingPoint(node, fuelVolumeUnit, armUnit)),
    cgEnvelope: (() => {
      const values = (aircraft.getAttribute('Envelope') ?? '')
        .split(',')
        .map((value) => parseNumber(value))
        .filter((value): value is number => value != null)

      const points = []
      for (let index = 0; index + 1 < values.length; index += 2) {
        points.push({
          arm: createMeasurement(values[index], armUnit, 'mm'),
          weight: createMeasurement(values[index + 1], fuelMassUnit, 'kg'),
        })
      }
      return points
    })(),
  }
  profile.performance = {
    ...profile.performance,
    serviceCeilingFt: parseInteger(aircraft.getAttribute('ServiceCeiling')),
    glideAirspeed: parseNumber(aircraft.getAttribute('GlideAirspeed')) != null
      ? createMeasurement(parseNumber(aircraft.getAttribute('GlideAirspeed'))!, 'kt', 'kt')
      : null,
    glideRatio: parseNumber(aircraft.getAttribute('GlideRatio')),
    defaultCruiseAltitudeFt: parseInteger(aircraft.getAttribute('DefaultLevel')),
    climb: {
      indicatedAirspeed: parseNumber(aircraft.querySelector('ClimbProfile')?.getAttribute('IndicatedAirspeed') ?? null) != null
        ? createMeasurement(parseNumber(aircraft.querySelector('ClimbProfile')?.getAttribute('IndicatedAirspeed') ?? null)!, 'kt', 'kt')
        : null,
      rateOfClimbSeaLevelFpm: parseInteger(aircraft.querySelector('ClimbProfile')?.getAttribute('FpmSL') ?? null),
      rateOfClimbServiceCeilingFpm: parseInteger(aircraft.querySelector('ClimbProfile')?.getAttribute('FpmSC') ?? null),
      fuelBurnSeaLevel: parseNumber(aircraft.querySelector('ClimbProfile')?.getAttribute('FuelBurnSL') ?? null) != null
        ? createMeasurement(parseNumber(aircraft.querySelector('ClimbProfile')?.getAttribute('FuelBurnSL') ?? null)!, fuelVolumeUnit, 'l')
        : null,
      fuelBurnServiceCeiling: parseNumber(aircraft.querySelector('ClimbProfile')?.getAttribute('FuelBurnSC') ?? null) != null
        ? createMeasurement(parseNumber(aircraft.querySelector('ClimbProfile')?.getAttribute('FuelBurnSC') ?? null)!, fuelVolumeUnit, 'l')
        : null,
    },
    descent: {
      indicatedAirspeed: parseNumber(aircraft.querySelector('DescentProfile')?.getAttribute('IndicatedAirspeed') ?? null) != null
        ? createMeasurement(parseNumber(aircraft.querySelector('DescentProfile')?.getAttribute('IndicatedAirspeed') ?? null)!, 'kt', 'kt')
        : null,
      descentRateFpm: parseInteger(aircraft.querySelector('DescentProfile')?.getAttribute('Fpm') ?? null),
      fuelBurn: parseNumber(aircraft.querySelector('DescentProfile')?.getAttribute('FuelBurn') ?? null) != null
        ? createMeasurement(parseNumber(aircraft.querySelector('DescentProfile')?.getAttribute('FuelBurn') ?? null)!, fuelVolumeUnit, 'l')
        : null,
    },
    cruiseProfiles: Array.from(aircraft.querySelectorAll('CruiseProfiles > CruiseProfile')).map((node, index) => ({
      id: `cruise-${index + 1}`,
      name: node.getAttribute('Name')?.trim() ?? `Cruise ${index + 1}`,
      airspeedType: node.getAttribute('AirspeedType')?.toLowerCase() === 'indicated' ? 'ias' : 'tas',
      entries: Array.from(node.querySelectorAll('Entry')).map((entry) => ({
        altitudeFt: parseInteger(entry.getAttribute('Level')) ?? 0,
        airspeed: createMeasurement(parseNumber(entry.getAttribute('Airspeed')) ?? 0, 'kt', 'kt'),
        fuelBurn: createMeasurement(parseNumber(entry.getAttribute('FuelBurn')) ?? 0, fuelVolumeUnit, 'l'),
      })),
    })),
  }
  profile.planningDefaults = {
    tasInputUnit: 'kt',
    reserveMinutes: profile.fuel.reserveMinutes,
    defaultCruiseProfileId: profile.performance.cruiseProfiles[0]?.id ?? null,
  }
  profile.sources = [
    createSourceRecord('skydemon_import', 'SkyDemon .aircraft', {
      fileName,
      summary: `${registration || 'Okänd registrering'} från ${fileName}`,
    }),
  ]

  return profile
}
