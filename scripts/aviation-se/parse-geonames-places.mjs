import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rawDir = resolve('data/aviation/se/raw/geonames')
const zipPath = resolve(rawDir, 'SE.zip')
const outputDir = resolve('data/aviation/se/normalized')
const generatedDir = resolve('src/features/flightplan/generated')
const publicDataDir = resolve('public/vfrplan-data')
const KIND_CODE = {
  settlement: 's',
  lake: 'l',
  water: 'w',
  island: 'i',
  mountain: 'm',
}

const FEATURE_CONFIG = new Map([
  ['PPL', { kind: 'settlement', importance: 0.82 }],
  ['PPLX', { kind: 'settlement', importance: 0.75 }],
  ['PPLA', { kind: 'settlement', importance: 0.96 }],
  ['PPLA2', { kind: 'settlement', importance: 0.92 }],
  ['PPLA3', { kind: 'settlement', importance: 0.88 }],
  ['PPLA4', { kind: 'settlement', importance: 0.84 }],
  ['PPLL', { kind: 'settlement', importance: 0.72 }],
  ['PPLF', { kind: 'settlement', importance: 0.7 }],
  ['LK', { kind: 'lake', importance: 0.74 }],
  ['LKS', { kind: 'lake', importance: 0.78 }],
  ['BAY', { kind: 'water', importance: 0.68 }],
  ['COVE', { kind: 'water', importance: 0.64 }],
  ['FJD', { kind: 'water', importance: 0.7 }],
  ['INLT', { kind: 'water', importance: 0.62 }],
  ['STM', { kind: 'water', importance: 0.58 }],
  ['ISL', { kind: 'island', importance: 0.82 }],
  ['ISLS', { kind: 'island', importance: 0.8 }],
  ['ISLT', { kind: 'island', importance: 0.72 }],
  ['ISLX', { kind: 'island', importance: 0.76 }],
  ['SHOL', { kind: 'island', importance: 0.68 }],
  ['RK', { kind: 'island', importance: 0.66 }],
  ['RKS', { kind: 'island', importance: 0.68 }],
  ['MT', { kind: 'mountain', importance: 0.8 }],
  ['MTS', { kind: 'mountain', importance: 0.82 }],
  ['PK', { kind: 'mountain', importance: 0.86 }],
  ['HLL', { kind: 'mountain', importance: 0.58 }],
  ['HLLS', { kind: 'mountain', importance: 0.56 }],
])

function ensureRawZip() {
  mkdirSync(rawDir, { recursive: true })

  if (existsSync(zipPath)) {
    return zipPath
  }

  execFileSync('curl', [
    '-L',
    '--fail',
    '--silent',
    '--show-error',
    '-o',
    zipPath,
    'https://download.geonames.org/export/dump/SE.zip',
  ])
  return zipPath
}

function readSwedenDump() {
  ensureRawZip()
  return execFileSync('unzip', ['-p', zipPath, 'SE.txt'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function normalizePopulation(rawPopulation) {
  const numeric = Number(rawPopulation)
  return Number.isFinite(numeric) ? numeric : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function computeImportance(featureCode, population) {
  const base = FEATURE_CONFIG.get(featureCode)?.importance ?? 0.5

  if (population <= 0) {
    return base
  }

  const populationBonus = clamp(Math.log10(population + 1) / 6, 0, 0.18)
  return Number((base + populationBonus).toFixed(3))
}

function parseRow(line) {
  const columns = line.split('\t')
  if (columns.length < 19) {
    return null
  }

  const featureCode = columns[7]
  const config = FEATURE_CONFIG.get(featureCode)
  if (!config) {
    return null
  }

  const name = columns[1]?.trim()
  if (!name) {
    return null
  }

  const lat = Number(columns[4])
  const lon = Number(columns[5])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  const population = normalizePopulation(columns[14])

  return {
    id: columns[0],
    name,
    lat,
    lon,
    kind: config.kind,
    featureClass: columns[6],
    featureCode,
    population,
    importance: computeImportance(featureCode, population),
  }
}

function dedupePlaces(entries) {
  const seen = new Map()

  for (const entry of entries) {
    const key = `${entry.name}|${entry.kind}|${entry.lat.toFixed(5)}|${entry.lon.toFixed(5)}`
    const previous = seen.get(key)

    if (!previous || entry.importance > previous.importance || entry.population > previous.population) {
      seen.set(key, entry)
    }
  }

  return [...seen.values()].sort((a, b) => b.importance - a.importance || b.population - a.population || a.name.localeCompare(b.name, 'sv'))
}

function writeOutputs(places) {
  mkdirSync(outputDir, { recursive: true })
  mkdirSync(generatedDir, { recursive: true })
  mkdirSync(publicDataDir, { recursive: true })

  const clientPlaces = places.map((place) => ({
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    kind: place.kind,
    importance: place.importance,
  }))
  const compactClientPlaces = clientPlaces.map((place) => [
    place.name,
    Number(place.lat.toFixed(4)),
    Number(place.lon.toFixed(4)),
    KIND_CODE[place.kind],
    Number(place.importance.toFixed(2)),
  ])

  const normalizedOutput = {
    generatedAt: new Date().toISOString(),
    source: 'GeoNames Sweden',
    sourceUrl: 'https://download.geonames.org/export/dump/SE.zip',
    count: places.length,
    places,
  }

  writeFileSync(resolve(outputDir, 'places.se.json'), `${JSON.stringify(normalizedOutput, null, 2)}\n`)
  writeFileSync(resolve(publicDataDir, 'places.se.json'), JSON.stringify(compactClientPlaces))
  writeFileSync(
    resolve(generatedDir, 'places.se.ts'),
    `export type SwedishPlaceKind = 'settlement' | 'lake' | 'water' | 'island' | 'mountain'

export type SwedishPlace = {
  name: string
  lat: number
  lon: number
  kind: SwedishPlaceKind
  importance: number
}
`,
  )
}

function main() {
  const rawDump = readSwedenDump()
  const places = dedupePlaces(
    rawDump
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseRow)
      .filter(Boolean),
  )

  writeOutputs(places)
  console.log(`Parsed ${places.length} Swedish place records into ${resolve(outputDir, 'places.se.json')}`)
}

main()
