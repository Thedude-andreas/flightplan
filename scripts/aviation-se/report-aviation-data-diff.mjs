import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const reportPath = process.argv[2] ? resolve(process.argv[2]) : null

const trackedFiles = [
  'data/aviation/se/normalized/airports.se.json',
  'data/aviation/se/normalized/airspaces.se.json',
  'data/aviation/se/normalized/places.se.json',
  'data/aviation/se/normalized/navaids.se.json',
  'data/aviation/se/normalized/airspace-frequencies.se.json',
  'data/aviation/se/normalized/airport-frequencies.se.json',
  'data/aviation/se/normalized/acc-sectors.se.json',
  'data/aviation/se/normalized/radio-nav.se.json',
  'data/aviation/se/normalized/visual-points.se.json',
  'data/aviation/se/normalized/aviation.se.index.json',
]

function readWorkingJson(path) {
  return existsSync(resolve(path)) ? JSON.parse(readFileSync(resolve(path), 'utf8')) : null
}

function readHeadJson(path) {
  try {
    const output = execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
    return JSON.parse(output)
  } catch {
    return null
  }
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

function normalizeCoordinate(value, precision = 5) {
  return typeof value === 'number' ? Number(value.toFixed(precision)) : value
}

function normalizeGeometry(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeGeometry(item))
  }

  return normalizeCoordinate(value)
}

function normalizeGeometryRecord(geometry) {
  if (!geometry) {
    return geometry
  }

  return {
    ...geometry,
    coordinates: normalizeGeometry(geometry.coordinates),
  }
}

function truncateList(items, maxItems = 12) {
  if (items.length <= maxItems) {
    return items
  }

  return [
    ...items.slice(0, maxItems),
    `- ... and ${items.length - maxItems} more`,
  ]
}

function makeSection(title, items) {
  if (items.length === 0) {
    return []
  }

  return [title, '', ...truncateList(items), '']
}

function summarizeDatasetCounts(path, current, previous) {
  const currentCount =
    current?.count ??
    current?.airports?.length ??
    current?.airspaces?.length ??
    current?.places?.length ??
    current?.navaids?.length ??
    current?.airportFrequencies?.length ??
    current?.airspaceFrequencies?.length ??
    current?.accSectors?.length ??
    current?.visualPoints?.length ??
    null

  const previousCount =
    previous?.count ??
    previous?.airports?.length ??
    previous?.airspaces?.length ??
    previous?.places?.length ??
    previous?.navaids?.length ??
    previous?.airportFrequencies?.length ??
    previous?.airspaceFrequencies?.length ??
    previous?.accSectors?.length ??
    previous?.visualPoints?.length ??
    null

  return `- \`${path}\`: ${previousCount ?? 'new'} -> ${currentCount ?? 'n/a'}`
}

function diffCollections(previousItems, currentItems, getId, summarize, summarizeChange = summarize) {
  const previousMap = new Map((previousItems ?? []).map((item) => [getId(item), item]))
  const currentMap = new Map((currentItems ?? []).map((item) => [getId(item), item]))

  const added = []
  const removed = []
  const changed = []

  for (const [id, currentItem] of currentMap) {
    if (!previousMap.has(id)) {
      added.push(`- added ${summarize(currentItem)}`)
      continue
    }

    const previousItem = previousMap.get(id)
    if (stableStringify(previousItem) !== stableStringify(currentItem)) {
      changed.push(`- changed ${summarizeChange(previousItem, currentItem)}`)
    }
  }

  for (const [id, previousItem] of previousMap) {
    if (!currentMap.has(id)) {
      removed.push(`- removed ${summarize(previousItem)}`)
    }
  }

  return { added, removed, changed }
}

function frequencyList(record) {
  return (record.frequencies ?? []).join(', ')
}

function summarizeAirportFrequency(record) {
  return `${record.positionIndicator} ${record.unit} [${record.kind}] -> ${frequencyList(record)}`
}

function summarizeAirportFrequencyChange(previous, current) {
  return `${current.positionIndicator} ${current.unit} [${current.kind}] ${frequencyList(previous)} -> ${frequencyList(current)}`
}

function summarizeAirspaceFrequency(record) {
  return `${record.positionIndicator ?? 'NO-ICAO'} ${record.name} -> ${record.unit ?? record.callSign ?? 'NO-UNIT'} -> ${frequencyList(record)}`
}

function summarizeAirspaceFrequencyChange(previous, current) {
  return `${current.positionIndicator ?? 'NO-ICAO'} ${current.name} -> ${current.unit ?? current.callSign ?? 'NO-UNIT'} ${frequencyList(previous)} -> ${frequencyList(current)}`
}

function summarizeNavaid(record) {
  const label = record.ident ?? record.name ?? record.id
  const frequency = record.frequency ?? (record.channel ? `CH ${record.channel}` : 'NO-FREQ')
  return `${label} [${record.kind}] -> ${frequency}`
}

function summarizeNavaidChange(previous, current) {
  const label = current.ident ?? current.name ?? current.id
  const previousFrequency = previous.frequency ?? (previous.channel ? `CH ${previous.channel}` : 'NO-FREQ')
  const currentFrequency = current.frequency ?? (current.channel ? `CH ${current.channel}` : 'NO-FREQ')
  return `${label} [${current.kind}] ${previousFrequency} -> ${currentFrequency}`
}

function comparableNavaid(record) {
  if (!record) {
    return record
  }

  const { id: _id, ...navaid } = record
  return {
    ...navaid,
    lat: normalizeCoordinate(record.lat),
    lon: normalizeCoordinate(record.lon),
  }
}

function summarizeAccSector(record) {
  const frequencies = (record.frequencies ?? []).join(', ')
  return `${record.sectorCode} ${record.sectorName} -> ${frequencies}`
}

function comparableAccSector(record) {
  if (!record) {
    return record
  }

  const { id: _id, frequencyLabel: _frequencyLabel, ...sector } = record
  return {
    ...sector,
    geometry: normalizeGeometryRecord(record.geometry),
  }
}

function summarizeVisualPoint(record) {
  return `${record.positionIndicator ?? 'NO-ICAO'} ${record.name} [${record.kind}] ${record.location ?? ''}`.trim()
}

function comparableVisualPoint(record) {
  if (!record) {
    return record
  }

  const { id: _id, effectiveFrom: _effectiveFrom, ...visualPoint } = record
  return {
    ...visualPoint,
    lat: normalizeCoordinate(record.lat),
    lon: normalizeCoordinate(record.lon),
  }
}

function summarizeAirspace(record) {
  const upper = record.upperLimit ?? record.upper ?? '?'
  const lower = record.lowerLimit ?? record.lower ?? '?'
  return `${record.positionIndicator ?? 'NO-ICAO'} ${record.name} [${record.kind}] ${lower} -> ${upper}`
}

function comparableAirspace(record) {
  if (!record) {
    return record
  }

  const { id: _id, effectiveFrom: _effectiveFrom, ...airspace } = record
  return {
    ...airspace,
    geometry: normalizeGeometryRecord(record.geometry),
  }
}

function summarizeAirport(record) {
  return `${record.icao ?? 'NO-ICAO'} ${record.name ?? 'NO-NAME'}`
}

function comparableAirport(record) {
  if (!record) {
    return record
  }

  return {
    icao: record.icao,
    name: record.name,
    lat: normalizeCoordinate(record.arp?.lat ?? record.lat),
    lon: normalizeCoordinate(record.arp?.lon ?? record.lon),
    category: record.category,
    detailsInAd2: record.detailsInAd2,
  }
}

function buildFrequencySections(previous, current) {
  const airportFrequencies = diffCollections(
    previous?.airportFrequencies,
    current?.airportFrequencies,
    (record) => `${record.positionIndicator}:${record.kind}:${record.unit}:${record.hours ?? ''}:${record.remarks ?? ''}`,
    summarizeAirportFrequency,
    summarizeAirportFrequencyChange,
  )

  const airspaceFrequencies = diffCollections(
    previous?.airspaceFrequencies,
    current?.airspaceFrequencies,
    (record) => `${record.positionIndicator ?? ''}:${record.kind}:${record.name}:${record.unit ?? record.callSign ?? ''}`,
    summarizeAirspaceFrequency,
    summarizeAirspaceFrequencyChange,
  )

  return [
    ...makeSection('## Airport Frequencies', [
      ...airportFrequencies.added,
      ...airportFrequencies.removed,
      ...airportFrequencies.changed,
    ]),
    ...makeSection('## Airspace Frequencies', [
      ...airspaceFrequencies.added,
      ...airspaceFrequencies.removed,
      ...airspaceFrequencies.changed,
    ]),
  ]
}

function buildAirspaceSections(previous, current) {
  const airspaces = diffCollections(
    previous?.airspaces?.map(comparableAirspace),
    current?.airspaces?.map(comparableAirspace),
    (record) => `${record.positionIndicator ?? ''}:${record.kind}:${record.name}:${record.location ?? ''}`,
    summarizeAirspace,
  )

  const sectors = diffCollections(
    previous?.accSectors?.map(comparableAccSector),
    current?.accSectors?.map(comparableAccSector),
    (record) => `${record.sectorCode}:${record.sectorName}`,
    summarizeAccSector,
  )

  return [
    ...makeSection('## Airspaces', [
      ...airspaces.added,
      ...airspaces.removed,
      ...airspaces.changed,
    ]),
    ...makeSection('## ACC Sectors', [
      ...sectors.added,
      ...sectors.removed,
      ...sectors.changed,
    ]),
  ]
}

function buildNavaidSections(previous, current) {
  const navaids = diffCollections(
    previous?.navaids?.map(comparableNavaid),
    current?.navaids?.map(comparableNavaid),
    (record) => `${record.kind}:${record.ident ?? ''}:${record.positionIndicator ?? ''}:${record.name ?? ''}`,
    summarizeNavaid,
    summarizeNavaidChange,
  )

  return makeSection('## Navaids', [
    ...navaids.added,
    ...navaids.removed,
    ...navaids.changed,
  ])
}

function buildAirportSections(previous, current) {
  const airports = diffCollections(
    previous?.airports?.map(comparableAirport),
    current?.airports?.map(comparableAirport),
    (record) => `${record.icao ?? ''}:${record.name ?? ''}`,
    summarizeAirport,
  )

  return makeSection('## Airports', [
    ...airports.added,
    ...airports.removed,
    ...airports.changed,
  ])
}

function buildVisualPointSections(previous, current) {
  const visualPoints = diffCollections(
    previous?.visualPoints?.map(comparableVisualPoint),
    current?.visualPoints?.map(comparableVisualPoint),
    (record) => `${record.positionIndicator ?? ''}:${record.kind}:${record.name}:${record.location ?? ''}`,
    summarizeVisualPoint,
  )

  return makeSection('## Visual Points', [
    ...visualPoints.added,
    ...visualPoints.removed,
    ...visualPoints.changed,
  ])
}

const changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', ...trackedFiles], {
  encoding: 'utf8',
}).split('\n').filter(Boolean)

const lines = ['# Swedish aviation data diff', '']

if (changedFiles.length === 0) {
  lines.push('No normalized aviation data files changed.')
} else {
  lines.push('## Changed datasets', '')
  for (const path of changedFiles) {
    lines.push(summarizeDatasetCounts(path, readWorkingJson(path), readHeadJson(path)))
  }
  lines.push('')

  const previousRadioNav = readHeadJson('data/aviation/se/normalized/radio-nav.se.json')
  const currentRadioNav = readWorkingJson('data/aviation/se/normalized/radio-nav.se.json')
  const previousAirspaces = readHeadJson('data/aviation/se/normalized/airspaces.se.json')
  const currentAirspaces = readWorkingJson('data/aviation/se/normalized/airspaces.se.json')
  const previousAirports = readHeadJson('data/aviation/se/normalized/airports.se.json')
  const currentAirports = readWorkingJson('data/aviation/se/normalized/airports.se.json')
  const previousVisualPoints = readHeadJson('data/aviation/se/normalized/visual-points.se.json')
  const currentVisualPoints = readWorkingJson('data/aviation/se/normalized/visual-points.se.json')

  lines.push(
    ...buildFrequencySections(previousRadioNav, currentRadioNav),
    ...buildAirspaceSections(previousAirspaces, currentAirspaces),
    ...buildNavaidSections(previousRadioNav, currentRadioNav),
    ...buildAirportSections(previousAirports, currentAirports),
    ...buildVisualPointSections(previousVisualPoints, currentVisualPoints),
  )
}

const report = `${lines.join('\n').trimEnd()}\n`

if (reportPath) {
  writeFileSync(reportPath, report)
} else {
  process.stdout.write(report)
}
