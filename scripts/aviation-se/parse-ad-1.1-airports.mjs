import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const candidatePaths = [
  resolve('data/aviation/se/raw/lfv/ES-AD-1.1-en-GB.html'),
  resolve('data/aviation/se/raw/lfv/AIP_OFFLINE/eAIP/ES-AD 1.1-en-GB.html'),
  resolve('data/aviation/se/raw/lfv/AIP_OFFLINE/eAIP/ES-AD%201.1-en-GB.html'),
]
const cachedSearchIndexPath = resolve('data/aviation/se/raw/lfv/searchIndex.current.js')

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

function findOfflineSearchIndex() {
  const extractedRoot = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE')
  if (!existsSync(extractedRoot)) {
    return null
  }

  const stack = [extractedRoot]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, name.name)
      if (name.isDirectory()) {
        stack.push(absolutePath)
      } else if (name.name === 'searchIndex.js') {
        return absolutePath
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

function normalizeAirportName(value) {
  return value.replace(/\/\s+/g, '/').replace(/\s+/g, ' ').trim()
}

function parseIdentity(identityLines) {
  const icaoIndex = identityLines.findIndex((line) => /^ES[A-Z0-9]{2}$/.test(line))
  if (icaoIndex >= 0) {
    const name = normalizeAirportName(identityLines.slice(0, icaoIndex).join(' '))
    return {
      name: name || null,
      icao: identityLines[icaoIndex] ?? null,
    }
  }

  return {
    name: identityLines[0] ? normalizeAirportName(identityLines[0]) : null,
    icao: /^ES[A-Z0-9]{2}$/.test(identityLines[1] ?? '') ? identityLines[1] : null,
  }
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

function decodeJsString(value) {
  return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
}

function extractArpFromAd2SearchIndex(searchIndexSource) {
  const ad2ByIcao = new Map()
  const entryPattern =
    /new Array\("((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"\);/g

  for (const match of searchIndexSource.matchAll(entryPattern)) {
    const filename = decodeJsString(match[1])
    const section = decodeJsString(match[2])
    const body = decodeJsString(match[5])

    if (section !== '/eAIP' || !/^ES-AD 2 [A-Z0-9]{4} .+ 1-[a-z]{2}-[A-Z]{2}\.html$/.test(filename)) {
      continue
    }

    const icaoMatch = filename.match(/^ES-AD 2 ([A-Z0-9]{4}) /)
    const coordinateMatch = body.match(/ARP coordinates and site at AD,(\d{6})([NS])\s*(\d{7})([EW])/)

    if (!icaoMatch || !coordinateMatch) {
      continue
    }

    ad2ByIcao.set(icaoMatch[1], {
      filename,
      coordinate: dmsToDecimal(
        coordinateMatch[1],
        coordinateMatch[2],
        coordinateMatch[3],
        coordinateMatch[4],
      ),
    })
  }

  return ad2ByIcao
}

async function fetchCurrentSearchIndex() {
  const historyUrl = 'https://aro.lfv.se/content/eaip/default_offline.html'
  const historyResponse = await fetch(historyUrl)

  if (!historyResponse.ok) {
    throw new Error(`Unable to fetch LFV eAIP history (${historyResponse.status})`)
  }

  const historyHtml = await historyResponse.text()
  const issueMatch = historyHtml.match(/href="([^"]+index-v2\.html)"/i)

  if (!issueMatch) {
    throw new Error('Unable to locate current LFV eAIP issue in default_offline.html')
  }

  const issueUrl = new URL(issueMatch[1].replace(/\\/g, '/'), historyUrl)
  const searchIndexUrl = new URL('searchIndex.js', issueUrl)
  const response = await fetch(searchIndexUrl)

  if (!response.ok) {
    throw new Error(`Unable to fetch LFV search index (${response.status})`)
  }

  return {
    source: searchIndexUrl.toString(),
    body: await response.text(),
  }
}

async function loadAd2ArpLookup() {
  const offlineSearchIndexPath = findOfflineSearchIndex()
  if (offlineSearchIndexPath) {
    return {
      source: offlineSearchIndexPath,
      entries: extractArpFromAd2SearchIndex(readFileSync(offlineSearchIndexPath, 'utf8')),
    }
  }

  try {
    const { source, body } = await fetchCurrentSearchIndex()
    writeFileSync(cachedSearchIndexPath, body)
    return {
      source,
      entries: extractArpFromAd2SearchIndex(body),
    }
  } catch (error) {
    if (existsSync(cachedSearchIndexPath)) {
      return {
        source: cachedSearchIndexPath,
        entries: extractArpFromAd2SearchIndex(readFileSync(cachedSearchIndexPath, 'utf8')),
      }
    }

    throw error
  }
}

async function main() {
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
  const { entries: ad2ArpByIcao, source: ad2Source } = await loadAd2ArpLookup()

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
    const identity = parseIdentity(identityLines)
    const ad2Coordinate = !coordinate && detailsInAd2 && identity.icao
      ? ad2ArpByIcao.get(identity.icao)?.coordinate ?? null
      : null

    return {
      name: identity.name,
      icao: identity.icao,
      detailsInAd2,
      arp: coordinate ?? ad2Coordinate,
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
        document: coordinate ? 'LFV AD 1.1' : 'LFV AD 1.1 + AD 2',
        path: coordinate ? inputPath : ad2Source,
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
        source: 'LFV AD 1.1 + AD 2',
        inputPath,
        ad2Source,
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

  const missingCoordinates = airports.filter((airport) => !airport.arp).length
  console.log(
    `Parsed ${airports.length} Swedish aerodromes into ${outputPath}. ${mapAirports.length} map airports, ${missingCoordinates} still missing coordinates.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
