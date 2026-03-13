import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const candidatePaths = [
  resolve('data/aviation/se/raw/lfv/ES-AD-1.1-en-GB.html'),
  resolve('data/aviation/se/raw/lfv/AIP_OFFLINE/eAIP/ES-AD 1.1-en-GB.html'),
  resolve('data/aviation/se/raw/lfv/AIP_OFFLINE/eAIP/ES-AD%201.1-en-GB.html'),
]

function findInputFile() {
  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  const extractedRoot = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE')
  if (existsSync(extractedRoot)) {
    const stack = [extractedRoot]
    while (stack.length > 0) {
      const current = stack.pop()
      for (const name of readdirSync(current, { withFileTypes: true })) {
        const absolutePath = resolve(current, name.name)
        if (name.isDirectory()) {
          stack.push(absolutePath)
        } else if (/ES-AD.?1\.1-en-GB\.html$/i.test(name.name)) {
          return absolutePath
        }
      }
    }
  }

  return null
}

function decodeEntities(value) {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&#160;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function stripCellToLines(cellHtml) {
  const withLineBreaks = cellHtml
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/li>/gi, '\n')

  return decodeEntities(withLineBreaks.replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\(\*\)/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function dmsToDecimal(latRaw, latHemisphere, lonRaw, lonHemisphere) {
  const latDeg = Number(latRaw.slice(0, 2))
  const latMin = Number(latRaw.slice(2, 4))
  const latSec = Number(latRaw.slice(4, 6))
  const lonDeg = Number(lonRaw.slice(0, 3))
  const lonMin = Number(lonRaw.slice(3, 5))
  const lonSec = Number(lonRaw.slice(5, 7))
  let lat = latDeg + latMin / 60 + latSec / 3600
  let lon = lonDeg + lonMin / 60 + lonSec / 3600

  if (latHemisphere === 'S') lat *= -1
  if (lonHemisphere === 'W') lon *= -1

  return { lat, lon }
}

function parseCoordinate(line) {
  const match = line.match(/^(\d{6})([NS])\s+(\d{7})([EW])$/)
  if (!match) {
    return null
  }

  const { lat, lon } = dmsToDecimal(match[1], match[2], match[3], match[4])

  return {
    raw: line,
    lat,
    lon,
  }
}

function splitAtsAndFuel(lines) {
  const ats = []
  const fuel = []

  for (const line of lines) {
    if (/^(TWR|AFIS|APP|ACC|ATS|MIL|A\/A|INFO|RADIO|FIS|ATIS|GND|TMC)$/i.test(line)) {
      ats.push(line)
    } else {
      fuel.push(line)
    }
  }

  return { ats, fuel }
}

function parseRunways(designators, dimensions, surface) {
  const runwayList = designators.length > 0 ? designators : ['']
  return runwayList.map((designator, index) => ({
    designator,
    dimensionsMeters: dimensions[index] ?? dimensions[0] ?? null,
    surface: surface[index] ?? surface[0] ?? null,
  }))
}

const inputPath = findInputFile()

if (!inputPath) {
  console.error('Unable to locate LFV AD 1.1 HTML source.')
  console.error('Expected a fetched HTML page or an extracted AIP offline package.')
  process.exit(1)
}

const html = readFileSync(inputPath, 'utf8')
const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0])
const aerodromeTable = tables.find((table) => /AD_1_1_B_TABLE/.test(table))

if (!aerodromeTable) {
  console.error('Unable to find AD 1.1 aerodrome table in source HTML.')
  process.exit(1)
}

const bodyMatch = aerodromeTable.match(/<tbody[\s\S]*?<\/tbody>/i)
if (!bodyMatch) {
  console.error('Aerodrome table did not contain a tbody section.')
  process.exit(1)
}

const rowMatches = [...bodyMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)]

const airports = rowMatches.map((rowMatch) => {
  const rowHtml = rowMatch[0]
  const cells = [...rowHtml.matchAll(/<td[\s\S]*?<\/td>/gi)].map((match) => stripCellToLines(match[0]))
  if (cells.length !== 8) {
    return null
  }

  const [identityLines, runwayLines, dimensionLines, surfaceLines, lightLines, atsFuelLines, frequencyLines, categoryLines] = cells
  const coordinateLine = identityLines.find((line) => /^\d{6}[NS]\s+\d{7}[EW]/.test(line)) ?? null
  const coordinate = coordinateLine ? parseCoordinate(coordinateLine) : null
  const locationLine = identityLines.find((line) => /\bNM\b/.test(line)) ?? null
  const elevationLine = identityLines.find((line) => /\bft\b/i.test(line)) ?? null
  const detailsInAd2 = identityLines.some((line) => /Details,\s*see AD 2/i.test(line))
  const { ats, fuel } = splitAtsAndFuel(atsFuelLines)

  return {
    name: identityLines[0] ?? null,
    icao: identityLines[1] ?? null,
    detailsInAd2,
    arp: coordinate,
    location: locationLine,
    elevationFt: elevationLine ? Number(elevationLine.replace(/[^\d.-]/g, '')) : null,
    runways: parseRunways(runwayLines, dimensionLines, surfaceLines),
    runwayLighting: lightLines,
    atsServices: ats,
    fuelTypes: fuel,
    communicationFrequencies: frequencyLines,
    category: categoryLines[0] ?? null,
    ownerOperator: categoryLines[1] ?? null,
    contactLines: categoryLines.slice(2),
    source: {
      document: 'LFV AD 1.1',
      path: inputPath,
    },
  }
}).filter(Boolean)

const outputPath = resolve('data/aviation/se/normalized/airports.se.json')
const generatedModulePath = resolve('src/features/flightplan/generated/airports.se.ts')
mkdirSync(resolve('data/aviation/se/normalized'), { recursive: true })
mkdirSync(resolve('src/features/flightplan/generated'), { recursive: true })
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: 'LFV AD 1.1',
      inputPath,
      count: airports.length,
      airports,
    },
    null,
    2,
  ),
)

const mapAirports = airports
  .filter((airport) => airport.arp?.lat != null && airport.arp?.lon != null)
  .map((airport) => ({
    icao: airport.icao,
    name: airport.name,
    lat: airport.arp.lat,
    lon: airport.arp.lon,
    category: airport.category,
    detailsInAd2: airport.detailsInAd2,
  }))

writeFileSync(
  generatedModulePath,
  `export type SwedishAirport = {
  icao: string | null
  name: string | null
  lat: number
  lon: number
  category: string | null
  detailsInAd2: boolean
}

export const swedishAirports: SwedishAirport[] = ${JSON.stringify(mapAirports, null, 2)}\n`,
)

console.log(`Parsed ${airports.length} Swedish aerodromes from LFV AD 1.1 into ${outputPath}`)
