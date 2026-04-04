import type { FlightPlanInput, RadioNavEntry, RoutePointInput } from './types'
import { swedishAirspaces } from './generated/airspaces.se'
import {
  swedishAirspaceFrequencies,
  swedishAirportFrequencies,
  swedishAccSectors,
  swedishNavaids,
  type SwedishAccSector,
  type SwedishAirspaceFrequency,
  type SwedishAirportFrequency,
  type SwedishNavaid,
} from './generated/radio-nav.se'

const maxSuggestedEntries = 12
const maxAirportEntriesPerEndpoint = 2
const maxRouteAirspaceEntries = 5
const maxNavaidEntries = 3
const earthRadiusNm = 3440.065

function degToRad(value: number) {
  return (value * Math.PI) / 180
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

function pointInRing(lat: number, lon: number, ring: number[][]) {
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function pointInPolygon(lat: number, lon: number, polygon: number[][][]) {
  if (polygon.length === 0) {
    return false
  }

  if (!pointInRing(lat, lon, polygon[0])) {
    return false
  }

  for (const hole of polygon.slice(1)) {
    if (pointInRing(lat, lon, hole)) {
      return false
    }
  }

  return true
}

function airspaceContainsPoint(
  airspace: (typeof swedishAirspaces)[number],
  lat: number,
  lon: number,
) {
  if (airspace.geometry.type === 'Polygon') {
    return pointInPolygon(lat, lon, airspace.geometry.coordinates)
  }

  return airspace.geometry.coordinates.some((polygon) => pointInPolygon(lat, lon, polygon))
}

function midpoint(from: RoutePointInput, to: RoutePointInput) {
  return {
    lat: (from.lat + to.lat) / 2,
    lon: (from.lon + to.lon) / 2,
  }
}

function compactCallSign(record: SwedishAirspaceFrequency) {
  const source = (record.callSign ?? record.unit ?? record.name).replace(/\s+/g, ' ').trim()
  return source
    .replace(/\bINFORMATION\b/i, 'INFO')
    .replace(/\bAPPROACH\b/i, 'APP')
    .replace(/\bCONTROL\b/i, 'CTL')
    .replace(/\bTOWER\b/i, 'TWR')
}

function formatAirspaceEntry(record: SwedishAirspaceFrequency): RadioNavEntry[] {
  const label = compactCallSign(record)
  return record.frequencies.map((frequency) => ({
    name: label,
    frequency: /^\d{3}\.\d{3}$/.test(frequency) ? `${frequency} MHz` : frequency,
  }))
}

function isEmergencyFrequency(frequency: string) {
  return frequency.trim() === '121.500'
}

function compactAirportUnit(record: SwedishAirportFrequency) {
  return record.unit
    .replace(/\bINFORMATION\b/i, 'INFO')
    .replace(/\bAPPROACH\b/i, 'APP')
    .replace(/\bTOWER\b/i, 'TWR')
    .replace(/\bGROUND\b/i, 'GND')
    .replace(/\bCLEARANCE DELIVERY\b/i, 'DEL')
}

function isDirectiveOnlyService(record: SwedishAirportFrequency) {
  const remarks = (record.remarks ?? '').toUpperCase()
  const unit = record.unit.toUpperCase()
  return remarks.includes('BY DIRECTIVE FROM TWR') || unit.includes('DE-ICING')
}

function formatAirportEntry(record: SwedishAirportFrequency): RadioNavEntry[] {
  const label = compactAirportUnit(record)
  return record.frequencies
    .filter((frequency) => !isEmergencyFrequency(frequency))
    .map((frequency) => ({
      name: label,
      frequency: /^\d{3}\.\d{3}$/.test(frequency) ? `${frequency} MHz` : frequency,
    }))
}

function preferAirportService(record: SwedishAirportFrequency) {
  const kind = record.kind.toUpperCase()
  if (kind.includes('ATIS')) {
    return 5
  }
  if (kind.includes('GND')) {
    return 4
  }
  if (kind.includes('APP')) {
    return 3
  }
  if (kind.includes('TWR')) {
    return 2
  }
  if (kind.includes('AFIS')) {
    return 1
  }
  return 0
}

function formatNavaidEntry(navaid: SwedishNavaid): RadioNavEntry {
  const kindLabel =
    navaid.kind === 'DMEV'
      ? 'VOR/DME'
      : navaid.kind

  return {
    name: `${navaid.ident ?? navaid.name ?? kindLabel} ${kindLabel}`,
    frequency: navaid.frequency ?? (navaid.channel ? `CH ${navaid.channel}` : ''),
  }
}

function sampleLegPoints(from: RoutePointInput, to: RoutePointInput) {
  return [
    from,
    {
      lat: from.lat + (to.lat - from.lat) * 0.25,
      lon: from.lon + (to.lon - from.lon) * 0.25,
    },
    midpoint(from, to),
    {
      lat: from.lat + (to.lat - from.lat) * 0.75,
      lon: from.lon + (to.lon - from.lon) * 0.75,
    },
    to,
  ]
}

function isPlaceholderName(value: string) {
  const normalized = value.trim().toLowerCase()
  return (
    normalized === '' ||
    normalized === 'funktion' ||
    normalized === 'stockholm radio'
  )
}

function isPlaceholderFrequency(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized === '' || normalized === 'frekvens' || normalized === '124.700'
}

function dedupeEntries(entries: RadioNavEntry[]) {
  const seen = new Set<string>()
  const unique: RadioNavEntry[] = []

  for (const entry of entries) {
    const key = `${entry.name}|${entry.frequency}`
    if (!entry.name || !entry.frequency || seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(entry)
  }

  return unique
}

function dedupeAirspaceFrequencyRecords<T extends { id: string; unit: string | null; frequencies: string[] }>(records: T[]) {
  const seen = new Set<string>()
  return records.filter((record) => {
    const key = `${record.unit ?? ''}|${record.frequencies.join('/')}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function pointInAccSector(sector: SwedishAccSector, lat: number, lon: number) {
  return pointInPolygon(lat, lon, sector.geometry.coordinates)
}

function findAirportRadioRecords(icao: string) {
  return swedishAirportFrequencies.filter(
    (record) => record.positionIndicator === icao && !isDirectiveOnlyService(record),
  )
}

function findAirportAirspaceFallbackRecords(icao: string) {
  return swedishAirspaceFrequencies.filter(
    (record) => record.positionIndicator === icao && record.kind !== 'FIR',
  )
}

function isGroundService(record: SwedishAirportFrequency) {
  const text = `${record.kind} ${record.unit}`.toUpperCase()
  return text.includes('GROUND') || /\bGND\b/.test(text)
}

function isTowerService(record: SwedishAirportFrequency) {
  const text = `${record.kind} ${record.unit}`.toUpperCase()
  return text.includes('TWR') || text.includes('TOWER') || text.includes('AFIS') || text.includes('INFORMATION')
}

function findAirspaceRadioRecords(airspace: (typeof swedishAirspaces)[number]) {
  const icao = airspace.positionIndicator
  if (!icao) {
    return []
  }

  const direct = dedupeAirspaceFrequencyRecords(
    swedishAirspaceFrequencies.filter(
      (record) =>
        record.positionIndicator === icao &&
        (record.kind === airspace.kind || (airspace.kind === 'TIZ' && record.kind === 'TIA')),
    ),
  )

  if (direct.length > 0) {
    return direct.flatMap(formatAirspaceEntry)
  }

  if (airspace.kind === 'CTR' || airspace.kind === 'TIZ') {
    const airportRecords = swedishAirportFrequencies
      .filter((record) => record.positionIndicator === icao)
      .filter((record) => !isDirectiveOnlyService(record))
      .filter((record) => isTowerService(record))
      .sort((a, b) => preferAirportService(b) - preferAirportService(a))

    return dedupeEntries(airportRecords.flatMap(formatAirportEntry)).slice(0, 2)
  }

  return []
}

function buildEndpointEntries(icao: string) {
  const directAirportRecords = findAirportRadioRecords(icao)
  if (directAirportRecords.length > 0) {
    const groundRecords = directAirportRecords.filter((record) => isGroundService(record))
    const towerRecords = directAirportRecords.filter((record) => isTowerService(record) && !isGroundService(record))
    const picked = [
      ...groundRecords.sort((a, b) => preferAirportService(b) - preferAirportService(a)).slice(0, 1),
      ...towerRecords.sort((a, b) => preferAirportService(b) - preferAirportService(a)).slice(0, 1),
    ]

    return dedupeEntries(picked.flatMap(formatAirportEntry)).slice(0, maxAirportEntriesPerEndpoint)
  }

  return dedupeEntries(findAirportAirspaceFallbackRecords(icao).flatMap(formatAirspaceEntry)).slice(
    0,
    maxAirportEntriesPerEndpoint,
  )
}

function buildSwedenControlEntries(plan: FlightPlanInput) {
  const routePoints = plan.routeLegs.flatMap((leg) => sampleLegPoints(leg.from, leg.to))
  if (routePoints.length === 0) {
    return []
  }

  const encountered = new Map<string, SwedishAccSector>()

  for (const point of routePoints) {
    const sectorsAtPoint = swedishAccSectors.filter((sector) => pointInAccSector(sector, point.lat, point.lon))
    for (const sector of sectorsAtPoint) {
      if (!encountered.has(sector.id)) {
        encountered.set(sector.id, sector)
      }
    }
  }

  return [...encountered.values()].flatMap((sector) => {
    const suffix = sector.sectorName.match(/ACC sector\s+(.+)$/i)?.[1] ?? sector.sectorCode
    const label = `Sweden CTL ${suffix}`.trim()
    return sector.frequencies.map((frequency) => ({
      name: label,
      frequency: /^\d{3}\.\d{3}$/.test(frequency) ? `${frequency} MHz` : frequency,
    }))
  })
}

function navaidRangeNm(navaid: SwedishNavaid) {
  switch (navaid.kind) {
    case 'VOR':
    case 'DMEV':
      return 80
    case 'DME':
      return 60
    case 'NDB':
      return 40
    default:
      return 50
  }
}

function findSuggestedNavaids(plan: FlightPlanInput) {
  const entries: RadioNavEntry[] = []
  const seenIds = new Set<string>()

  for (const leg of plan.routeLegs) {
    if (leg.navRef) {
      const exact = swedishNavaids.find((navaid) => navaid.ident?.toUpperCase() === leg.navRef.trim().toUpperCase())
      if (exact) {
        if (!seenIds.has(exact.id)) {
          seenIds.add(exact.id)
          entries.push(formatNavaidEntry(exact))
        }
        continue
      }
    }

    const nearest = swedishNavaids
      .map((navaid) => {
        const points = sampleLegPoints(leg.from, leg.to)
        const bestDistance = Math.min(...points.map((point) => distanceNm(point.lat, point.lon, navaid.lat, navaid.lon)))
        return {
          navaid,
          distance: bestDistance,
        }
      })
      .filter((candidate) => candidate.distance <= navaidRangeNm(candidate.navaid))
      .sort((a, b) => a.distance - b.distance)[0]

    if (nearest && !seenIds.has(nearest.navaid.id)) {
      seenIds.add(nearest.navaid.id)
      entries.push(formatNavaidEntry(nearest.navaid))
    }
  }

  return entries.slice(0, maxNavaidEntries)
}

export function buildSuggestedRadioNav(plan: FlightPlanInput) {
  const routeEntries: RadioNavEntry[] = []
  const airportEntries: RadioNavEntry[] = []
  const controlEntries: RadioNavEntry[] = []
  const navEntries: RadioNavEntry[] = []

  const departureIcao = plan.header.departureAerodrome.trim().toUpperCase()
  const destinationIcao = plan.header.destinationAerodrome.trim().toUpperCase()

  if (departureIcao) {
    airportEntries.push(...buildEndpointEntries(departureIcao))
  }

  if (destinationIcao && destinationIcao !== departureIcao) {
    airportEntries.push(...buildEndpointEntries(destinationIcao))
  }

  const crossedAirspaces = plan.routeLegs
    .flatMap((leg) => {
      const points = sampleLegPoints(leg.from, leg.to)
      return points.flatMap((point) => swedishAirspaces.filter((airspace) => airspaceContainsPoint(airspace, point.lat, point.lon)))
    })
    .flatMap(findAirspaceRadioRecords)

  routeEntries.push(...dedupeEntries(crossedAirspaces).slice(0, maxRouteAirspaceEntries))
  controlEntries.push(...buildSwedenControlEntries(plan))
  navEntries.push(...findSuggestedNavaids(plan))

  return dedupeEntries([...airportEntries, ...controlEntries, ...routeEntries, ...navEntries]).slice(0, maxSuggestedEntries)
}

export function mergeRadioNavEntries(
  currentEntries: RadioNavEntry[],
  suggestedEntries: RadioNavEntry[],
) {
  return Array.from({ length: Math.max(maxSuggestedEntries, currentEntries.length, suggestedEntries.length) }, (_, index) => {
    const current = currentEntries[index] ?? { name: '', frequency: '' }
    const suggested = suggestedEntries[index] ?? { name: '', frequency: '' }

    return {
      name: isPlaceholderName(current.name) ? suggested.name : current.name,
      frequency: isPlaceholderFrequency(current.frequency) ? suggested.frequency : current.frequency,
    }
  }).slice(0, maxSuggestedEntries)
}
