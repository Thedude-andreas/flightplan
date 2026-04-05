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
    null

  return `- \`${path}\`: ${previousCount ?? 'new'} -> ${currentCount ?? 'n/a'}`
}

function diffCollections(previousItems, currentItems, getId, summarize) {
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
      changed.push(`- changed ${summarize(currentItem)}`)
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

function summarizeAirspaceFrequency(record) {
  return `${record.positionIndicator ?? 'NO-ICAO'} ${record.name} -> ${record.unit ?? record.callSign ?? 'NO-UNIT'} -> ${frequencyList(record)}`
}

function summarizeNavaid(record) {
  const label = record.ident ?? record.name ?? record.id
  const frequency = record.frequency ?? (record.channel ? `CH ${record.channel}` : 'NO-FREQ')
  return `${label} [${record.kind}] -> ${frequency}`
}

function summarizeAccSector(record) {
  const frequencies = (record.frequencies ?? []).join(', ')
  return `${record.sectorCode} ${record.sectorName} -> ${frequencies}`
}

function summarizeAirspace(record) {
  const upper = record.upperLimit ?? record.upper ?? '?'
  const lower = record.lowerLimit ?? record.lower ?? '?'
  return `${record.positionIndicator ?? 'NO-ICAO'} ${record.name} [${record.kind}] ${lower} -> ${upper}`
}

function summarizeAirport(record) {
  return `${record.icao ?? 'NO-ICAO'} ${record.name ?? 'NO-NAME'}`
}

function buildFrequencySections(previous, current) {
  const airportFrequencies = diffCollections(
    previous?.airportFrequencies,
    current?.airportFrequencies,
    (record) => `${record.positionIndicator}:${record.kind}:${record.unit}:${frequencyList(record)}`,
    summarizeAirportFrequency,
  )

  const airspaceFrequencies = diffCollections(
    previous?.airspaceFrequencies,
    current?.airspaceFrequencies,
    (record) => `${record.positionIndicator ?? ''}:${record.kind}:${record.name}:${record.unit ?? record.callSign ?? ''}:${frequencyList(record)}`,
    summarizeAirspaceFrequency,
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
    previous?.airspaces,
    current?.airspaces,
    (record) => `${record.positionIndicator ?? ''}:${record.kind}:${record.name}`,
    summarizeAirspace,
  )

  const sectors = diffCollections(
    previous?.accSectors,
    current?.accSectors,
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
    previous?.navaids,
    current?.navaids,
    (record) => `${record.ident ?? record.name ?? ''}:${record.kind}:${record.frequency ?? record.channel ?? ''}`,
    summarizeNavaid,
  )

  return makeSection('## Navaids', [
    ...navaids.added,
    ...navaids.removed,
    ...navaids.changed,
  ])
}

function buildAirportSections(previous, current) {
  const airports = diffCollections(
    previous?.airports,
    current?.airports,
    (record) => `${record.icao ?? ''}:${record.name ?? ''}`,
    summarizeAirport,
  )

  return makeSection('## Airports', [
    ...airports.added,
    ...airports.removed,
    ...airports.changed,
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

  lines.push(
    ...buildFrequencySections(previousRadioNav, currentRadioNav),
    ...buildAirspaceSections(previousAirspaces, currentAirspaces),
    ...buildNavaidSections(previousRadioNav, currentRadioNav),
    ...buildAirportSections(previousAirports, currentAirports),
  )
}

const report = `${lines.join('\n').trimEnd()}\n`

if (reportPath) {
  writeFileSync(reportPath, report)
} else {
  process.stdout.write(report)
}
