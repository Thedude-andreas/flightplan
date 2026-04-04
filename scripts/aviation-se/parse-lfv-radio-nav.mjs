import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cachedSearchIndexPath = resolve('data/aviation/se/raw/lfv/searchIndex.current.js')
const offlineZipPath = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE.zip')
const WFS_BASE_URL = 'https://daim.lfv.se/geoserver/ows'
const NAVAID_LAYERS = [
  { typeName: 'mais:VOR', kind: 'VOR' },
  { typeName: 'mais:DMEV', kind: 'DMEV' },
  { typeName: 'mais:DME', kind: 'DME' },
  { typeName: 'mais:NDB', kind: 'NDB' },
]

function decodeJsString(value) {
  return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
}

function normalizeText(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[/.(),:+-]+/g, ' ')
    .replace(/\b(tma|tia|tiz|rmz|ctr|sector|part|of|area|traffic|information|zone|approach|tower|control)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isFrequencyToken(value) {
  return /^\d{3}\.\d{3}$/.test(value) || /^\d{3}\.\d{2}$/.test(value)
}

function looksLikeLateralLimit(value) {
  return /\d{6}[NS]\d{7}[EW]/.test(value) || /A circle with radius/i.test(value)
}

function looksLikeVerticalLimit(value) {
  return /(?:FL\s*\d+|\d+\s*ft\s*AMSL|GND|SFC|UNL|\d+)/i.test(value)
}

function normalizeFrequency(value) {
  if (!value) {
    return null
  }

  const normalized = value
    .replace(/\s+/g, ' ')
    .replace(/MHZ/i, ' MHz')
    .replace(/KHZ/i, ' kHz')
    .trim()

  return normalized || null
}

function normalizeAltitudeValue(value) {
  if (value == null) {
    return null
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  if (/^FL\s*\d+$/i.test(normalized)) {
    return normalized.replace(/^FL\s*(\d+)$/i, (_match, level) => `FL ${String(level).padStart(3, '0')}`)
  }

  if (/^\d+$/.test(normalized)) {
    return `${normalized} ft AMSL`
  }

  if (/^(GND|SFC|UNL)$/i.test(normalized)) {
    return normalized.toUpperCase()
  }

  return normalized
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&shy;/gi, '')
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(
    value
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/?(?:div|p|span|strong|em|a|table|tbody|thead|tr|td|th)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim(),
  )
}

function normalizeChannel(value) {
  if (!value) {
    return null
  }

  const match = value.match(/Channel:?\s*([A-Z0-9]+)/i)
  if (match) {
    return match[1]
  }

  return null
}

function normalizeDisplayText(value) {
  return value
    .replace(/Ã/g, 'Ö')
    .replace(/Ã/g, 'Ä')
    .replace(/Ã/g, 'Å')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã¤/g, 'ä')
    .replace(/Ã¥/g, 'å')
    .replace(/Ã¸/g, 'ø')
    .replace(/Ã/g, 'Ø')
}

function parseDmsCoordinate(token) {
  const match = token.match(/^(\d{2,3})(\d{2})(\d{2})([NS])(\d{3})(\d{2})(\d{2})([EW])$/)
  if (!match) {
    return null
  }

  const latDeg = Number.parseInt(match[1], 10)
  const latMin = Number.parseInt(match[2], 10)
  const latSec = Number.parseInt(match[3], 10)
  const lonDeg = Number.parseInt(match[5], 10)
  const lonMin = Number.parseInt(match[6], 10)
  const lonSec = Number.parseInt(match[7], 10)

  const lat = latDeg + latMin / 60 + latSec / 3600
  const lon = lonDeg + lonMin / 60 + lonSec / 3600

  return [
    match[8] === 'W' ? -lon : lon,
    match[4] === 'S' ? -lat : lat,
  ]
}

function normalizeLateralLimitToRing(value) {
  const compact = value
    .replace(/\s+/g, ' ')
    .replace(/clockwise along an arc of .*? centred on \d{6,7}[NS]\d{7,8}[EW]/gi, '')
    .replace(/along the FIR BDRY to/gi, '')
    .replace(/Within,/gi, '')
    .replace(/to point of origin\.?/gi, '')
    .trim()

  const coordinates = [...compact.matchAll(/\d{6,7}[NS]\d{7,8}[EW]/g)]
    .map((match) => parseDmsCoordinate(match[0]))
    .filter(Boolean)

  if (coordinates.length < 3) {
    return null
  }

  const [firstLon, firstLat] = coordinates[0]
  const [lastLon, lastLat] = coordinates[coordinates.length - 1]
  if (firstLon !== lastLon || firstLat !== lastLat) {
    coordinates.push(coordinates[0])
  }

  return coordinates
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

function listOfflineAirportPages() {
  const entries = []

  if (existsSync(offlineZipPath)) {
    const output = execFileSync(
      'python3',
      [
        '-c',
        `
import json
import re
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = []
    for name in archive.namelist():
        match = re.match(r'^eAIP/ES-AD 2 ([A-Z]{4}) .* 1-en-GB\\.html$', name)
        if match:
            entries.append({"icao": match.group(1), "path": name})
    print(json.dumps(entries, ensure_ascii=False))
        `,
        offlineZipPath,
      ],
      {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })

    return JSON.parse(output).map((entry) => ({ ...entry, source: 'zip' }))
  }

  const extractedDir = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE/eAIP')
  if (!existsSync(extractedDir)) {
    return []
  }

  for (const entry of readdirSync(extractedDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue
    }

    const match = entry.name.match(/^ES-AD 2 ([A-Z]{4}) .* 1-en-GB\.html$/)
    if (match) {
      entries.push({
        icao: match[1],
        source: 'file',
        path: resolve(extractedDir, entry.name),
      })
    }
  }

  return entries
}

function readOfflineAirportPage(entry) {
  if (entry.source === 'zip') {
    return execFileSync(
      'python3',
      [
        '-c',
        `
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    sys.stdout.write(archive.read(sys.argv[2]).decode('utf-8', errors='replace'))
        `,
        offlineZipPath,
        entry.path,
      ],
      {
      encoding: 'utf8',
      maxBuffer: 15 * 1024 * 1024,
    }).replace(/\u0000/g, '')
  }

  return readFileSync(entry.path, 'utf8').replace(/\u0000/g, '')
}

function extractAd218Section(html) {
  const start = html.indexOf('AD2.18_TITLE')
  const end = html.indexOf('AD2.19_TITLE')
  if (start < 0 || end < 0 || end <= start) {
    return null
  }

  return html.slice(start, end)
}

function parseTableCells(rowHtml) {
  return [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((match) => {
    const rowspanMatch = match[1].match(/\browspan="(\d+)"/i)
    return {
      rowspan: Number.parseInt(rowspanMatch?.[1] ?? '1', 10),
      text: cleanHtmlText(match[2]),
    }
  })
}

function parseAd218Page(icao, html) {
  const section = extractAd218Section(html)
  if (!section) {
    return []
  }

  const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  const records = []
  let currentService = null
  let serviceRowsLeft = 0
  let currentUnit = null
  let unitRowsLeft = 0

  for (const [, rowHtml] of rows) {
    const cells = parseTableCells(rowHtml)
    if (cells.length < 3 || cells.length > 5) {
      if (serviceRowsLeft > 0) {
        serviceRowsLeft -= 1
      }
      if (unitRowsLeft > 0) {
        unitRowsLeft -= 1
      }
      continue
    }

    let cellIndex = 0
    let service = currentService
    let unit = currentUnit

    if (serviceRowsLeft === 0 && cells.length >= 4) {
      service = cells[cellIndex].text
      currentService = service
      serviceRowsLeft = cells[cellIndex].rowspan
      cellIndex += 1
    }

    if (unitRowsLeft === 0 && cells.length - cellIndex >= 4) {
      unit = cells[cellIndex].text
      currentUnit = unit
      unitRowsLeft = cells[cellIndex].rowspan
      cellIndex += 1
    }

    const frequency = normalizeFrequency(cells[cellIndex]?.text ?? null)
    const hours = cells[cellIndex + 1]?.text ?? null
    const remarks = cells[cellIndex + 2]?.text ?? null

    if (service && unit && frequency) {
      records.push({
        icao,
        service,
        unit,
        frequency,
        hours,
        remarks: remarks === '-' ? null : remarks,
      })
    }

    if (serviceRowsLeft > 0) {
      serviceRowsLeft -= 1
    }
    if (unitRowsLeft > 0) {
      unitRowsLeft -= 1
    }
  }

  const grouped = new Map()
  for (const record of records) {
    const key = `${record.icao}:${record.service}:${record.unit}:${record.hours ?? ''}:${record.remarks ?? ''}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        kind: record.service,
        positionIndicator: record.icao,
        unit: record.unit,
        hours: record.hours,
        remarks: record.remarks,
        frequencies: [],
      })
    }

    grouped.get(key).frequencies.push(record.frequency)
  }

  return [...grouped.values()].map((record, index) => ({
    ...record,
    id: `${record.positionIndicator}-${record.kind}-${index + 1}`,
    frequencies: [...new Set(record.frequencies)],
  }))
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

async function loadSearchIndexSource() {
  const offlineSearchIndexPath = findOfflineSearchIndex()
  if (offlineSearchIndexPath) {
    return {
      source: offlineSearchIndexPath,
      body: readFileSync(offlineSearchIndexPath, 'utf8'),
    }
  }

  try {
    const online = await fetchCurrentSearchIndex()
    writeFileSync(cachedSearchIndexPath, online.body)
    return online
  } catch (error) {
    if (existsSync(cachedSearchIndexPath)) {
      return {
        source: cachedSearchIndexPath,
        body: readFileSync(cachedSearchIndexPath, 'utf8'),
      }
    }

    throw error
  }
}

function extractSearchIndexBody(searchIndexSource, filename) {
  const entryPattern =
    /new Array\("((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"\);/g

  for (const match of searchIndexSource.matchAll(entryPattern)) {
    if (decodeJsString(match[1]) === filename) {
      return decodeJsString(match[5])
    }
  }

  return null
}

function buildAliasLookup() {
  const airports = JSON.parse(readFileSync(resolve('data/aviation/se/normalized/airports.se.json'), 'utf8')).airports ?? []
  const airspaces = JSON.parse(readFileSync(resolve('data/aviation/se/normalized/airspaces.se.json'), 'utf8')).airspaces ?? []
  const aliasesByIcao = new Map()

  const addAlias = (icao, raw) => {
    if (!icao || !raw) {
      return
    }

    const normalized = normalizeText(raw)
    if (!normalized) {
      return
    }

    if (!aliasesByIcao.has(icao)) {
      aliasesByIcao.set(icao, new Set([icao.toLowerCase()]))
    }

    const aliasSet = aliasesByIcao.get(icao)
    aliasSet.add(normalized)

    for (const token of normalized.split(' ')) {
      if (token.length >= 4) {
        aliasSet.add(token)
      }
    }
  }

  for (const airport of airports) {
    addAlias(airport.icao, airport.name)
  }

  for (const airspace of airspaces) {
    if (!airspace.positionIndicator) {
      continue
    }

    addAlias(airspace.positionIndicator, airspace.name)
    addAlias(airspace.positionIndicator, airspace.location)
  }

  return aliasesByIcao
}

function resolvePositionIndicator(aliasesByIcao, ...candidates) {
  let best = { icao: null, score: 0 }

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate ?? '')
    if (!normalized) {
      continue
    }

    for (const [icao, aliases] of aliasesByIcao.entries()) {
      for (const alias of aliases) {
        if (!alias || alias.length < 4) {
          continue
        }

        if (!normalized.includes(alias)) {
          continue
        }

        const score = alias.length + (normalized === alias ? 20 : 0)
        if (score > best.score) {
          best = { icao, score }
        }
      }
    }
  }

  return best.icao
}

function parseSectionRows(tokens, startMarker, endMarker, kind) {
  const start = tokens.indexOf(startMarker)
  const end = endMarker === '__END__' ? tokens.length : tokens.indexOf(endMarker)
  if (start < 0 || end < 0 || end <= start) {
    return []
  }

  const rows = []
  const firstRowIndex = start + 25

  for (let index = firstRowIndex; index < end - 2; index += 1) {
    const name = tokens[index]
    const lateral = tokens[index + 1]
    const vertical = tokens[index + 2]

    if (!name || !looksLikeLateralLimit(lateral) || !looksLikeVerticalLimit(vertical)) {
      continue
    }

    let nextIndex = index + 3
    while (
      nextIndex < end - 2 &&
      !(
        tokens[nextIndex] &&
        looksLikeLateralLimit(tokens[nextIndex + 1]) &&
        looksLikeVerticalLimit(tokens[nextIndex + 2])
      )
    ) {
      nextIndex += 1
    }

    const extras = tokens.slice(index + 3, nextIndex)
    const classIndex = extras.findIndex((token) => /^Class\b/i.test(token))
    const unit = classIndex >= 0 ? extras[classIndex + 1] ?? null : null
    const callSign = classIndex >= 0 ? extras[classIndex + 2] ?? null : null
    const frequencies = [...new Set(extras.filter(isFrequencyToken))]

    rows.push({
      kind,
      name,
      unit,
      callSign,
      frequencies,
    })

    index = nextIndex - 1
  }

  return rows
}

function parseFirRows(tokens) {
  const start = tokens.indexOf('1 List of FIR')
  const end = tokens.indexOf('2 List of CTA')
  if (start < 0 || end < 0 || end <= start) {
    return []
  }

  const swedenIndex = tokens.indexOf('SWEDEN FIR')
  if (swedenIndex < 0 || swedenIndex >= end) {
    return []
  }

  const extras = tokens.slice(swedenIndex + 3, end)
  const records = []
  let index = 0

  while (index < extras.length - 3) {
    const unit = extras[index]
    const callSign = extras[index + 1]
    const languages = extras[index + 2]
    const hours = extras[index + 3]

    if (!unit || !callSign || !languages || !hours) {
      break
    }

    if (!/^(?:[A-ZÅÄÖ].*ACC)$/i.test(unit) || !/(CONTROL|INFORMATION)/i.test(callSign)) {
      index += 1
      continue
    }

    let nextIndex = index + 4
    while (nextIndex < extras.length && isFrequencyToken(extras[nextIndex])) {
      nextIndex += 1
    }

    const frequencies = [...new Set(extras.slice(index + 4, nextIndex).filter(isFrequencyToken))]
    if (frequencies.length > 0) {
      records.push({
        kind: 'FIR',
        name: 'SWEDEN FIR',
        unit,
        callSign,
        frequencies,
      })
    }

    index = nextIndex
  }

  return records
}

function parseAccSectorRows(tokens) {
  const start = tokens.indexOf('ACC-sectors')
  const end = tokens.indexOf('7 Non-standard Planning Zone (NPZ)')
  if (start < 0 || end < 0 || end <= start) {
    return []
  }

  const section = tokens.slice(start + 5, end)
  const rows = []
  const isSectorName = (value) => /^(ESMM|ESOS) ACC sector [A-Z0-9]+$/i.test(value)
  const isSubArea = (value) => /^(ESMM|ESOS) [A-Z0-9]+:\d+$/i.test(value)

  let index = 0
  while (index < section.length - 4) {
    const sectorName = section[index]
    if (!isSectorName(sectorName)) {
      index += 1
      continue
    }

    let nextIndex = index + 1
    const frequencyTokens = []
    while (nextIndex < section.length && !isSubArea(section[nextIndex]) && !isSectorName(section[nextIndex])) {
      frequencyTokens.push(section[nextIndex])
      nextIndex += 1
    }

    const frequencies = frequencyTokens
      .flatMap((token) => [...token.matchAll(/\d{3}\.\d{3}/g)].map((match) => match[0]))
      .filter(Boolean)

    const frequencyLabel = normalizeDisplayText(frequencyTokens.join(', ').replace(/\s+/g, ' ').trim())

    while (nextIndex < section.length && isSubArea(section[nextIndex])) {
      const subAreaName = section[nextIndex]
      const lateral = section[nextIndex + 1] ?? ''
      const upper = normalizeAltitudeValue(section[nextIndex + 2] ?? null)
      const lower = normalizeAltitudeValue(section[nextIndex + 3] ?? null)
      let remarks = section[nextIndex + 4] ?? null

      if (remarks && (isSectorName(remarks) || isSubArea(remarks))) {
        remarks = null
      }

      rows.push({
        sectorName: normalizeDisplayText(sectorName),
        subAreaName,
        frequencyLabel,
        frequencies,
        lateral,
        upper,
        lower,
        remarks: remarks ? normalizeDisplayText(remarks) : null,
      })

      nextIndex += remarks ? 5 : 4
    }

    index = nextIndex
  }

  return rows
}

async function fetchNavaidLayer(layer) {
  const url = new URL(WFS_BASE_URL)
  url.searchParams.set('service', 'WFS')
  url.searchParams.set('version', '1.0.0')
  url.searchParams.set('request', 'GetFeature')
  url.searchParams.set('typeName', layer.typeName)
  url.searchParams.set('outputFormat', 'application/json')
  url.searchParams.set('srsName', 'EPSG:4326')

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Flightplan/1.0 (+https://andreasmartensson.com/flightplan/)',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${layer.typeName}: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return (data.features ?? [])
    .filter((feature) => feature.geometry?.type === 'Point')
    .map((feature, index) => {
      const properties = feature.properties ?? {}
      return {
        id: `${layer.kind}-${properties.MSID ?? properties.IDNR ?? index + 1}`,
        kind: layer.kind,
        ident: properties.NAMEOFPOINT ?? null,
        positionIndicator: properties.POSITIONINDICATOR ?? null,
        name: properties.LOCATION ?? properties.NAMEOFPOINT ?? null,
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        frequency: normalizeFrequency(properties.FREQ),
        channel: normalizeChannel(properties.COMMENT_1),
        remarks: properties.COMMENT_2 ?? null,
      }
    })
}

const aliasesByIcao = buildAliasLookup()
const { body: searchIndexSource, source: searchIndexPath } = await loadSearchIndexSource()
const enrBody = extractSearchIndexBody(searchIndexSource, 'ES-ENR 2.1-en-GB.html')
const enr22Body = extractSearchIndexBody(searchIndexSource, 'ES-ENR 2.2-en-GB.html')

if (!enrBody) {
  throw new Error('Unable to locate ES-ENR 2.1 in LFV search index')
}
if (!enr22Body) {
  throw new Error('Unable to locate ES-ENR 2.2 in LFV search index')
}

const enrTokens = enrBody.split(',').map((token) => normalizeDisplayText(token.trim())).filter(Boolean)
const enr22Tokens = enr22Body.split(',').map((token) => normalizeDisplayText(token.trim())).filter(Boolean)
const firRows = parseFirRows(enrTokens)
const tmaRows = parseSectionRows(enrTokens, '3 List of TMA', '4 List of TIA', 'TMA')
const tiaRows = parseSectionRows(enrTokens, '4 List of TIA', '__END__', 'TIA')
const accSectorRows = parseAccSectorRows(enr22Tokens)

const airspaceFrequencies = [...firRows, ...tmaRows, ...tiaRows]
  .map((row, index) => ({
    id: `${row.kind}-${index + 1}`,
    kind: row.kind,
    name: row.name,
    positionIndicator:
      row.kind === 'FIR'
        ? 'ESAA'
        : resolvePositionIndicator(aliasesByIcao, row.name, row.unit, row.callSign),
    unit: row.unit,
    callSign: row.callSign,
    frequencies: row.frequencies,
  }))
  .filter((row) => row.frequencies.length > 0)

const currentAirspaces = JSON.parse(readFileSync(resolve('data/aviation/se/normalized/airspaces.se.json'), 'utf8')).airspaces ?? []
const tizByIcao = new Set(
  currentAirspaces.filter((airspace) => airspace.kind === 'TIZ').map((airspace) => airspace.positionIndicator).filter(Boolean),
)
const inferredTizFrequencies = airspaceFrequencies
  .filter((row) => row.kind === 'TIA' && row.positionIndicator && tizByIcao.has(row.positionIndicator))
  .map((row, index) => ({
    ...row,
    id: `TIZ-${index + 1}`,
    kind: 'TIZ',
    name: row.name.replace(/TIA/gi, 'TIZ'),
  }))

const allAirspaceFrequencies = [...airspaceFrequencies, ...inferredTizFrequencies]

const navaidLayers = await Promise.all(NAVAID_LAYERS.map(fetchNavaidLayer))
const navaids = navaidLayers.flat()

const airportPageEntries = listOfflineAirportPages()
const airportFrequencies = airportPageEntries.flatMap((entry) => parseAd218Page(entry.icao, readOfflineAirportPage(entry)))

const inferredAirportFrequencies = [...new Map(
  allAirspaceFrequencies
    .filter((row) => row.positionIndicator && row.kind !== 'FIR')
    .map((row) => [
      `${row.positionIndicator}:${row.kind}:${row.callSign ?? row.unit ?? row.name}:${row.frequencies.join('/')}`,
      {
        id: `${row.positionIndicator}:${row.kind}:${row.callSign ?? row.unit ?? row.name}`,
        kind: row.kind,
        positionIndicator: row.positionIndicator,
        unit: row.callSign ?? row.unit ?? row.name,
        hours: null,
        remarks: null,
        frequencies: row.frequencies,
      },
    ]),
).values()]

const airportsWithAd218 = new Set(airportFrequencies.map((record) => record.positionIndicator))
const mergedAirportFrequencies = [
  ...airportFrequencies,
  ...inferredAirportFrequencies.filter((record) => !airportsWithAd218.has(record.positionIndicator)),
]

const accSectors = accSectorRows
  .map((row, index) => {
    const ring = normalizeLateralLimitToRing(row.lateral)
    if (!ring || row.frequencies.length === 0) {
      return null
    }

    return {
      id: `ACC-${index + 1}`,
      sectorName: row.sectorName,
      sectorCode: row.subAreaName,
      frequencyLabel: row.frequencyLabel,
      frequencies: row.frequencies,
      upper: row.upper,
      lower: row.lower,
      remarks: row.remarks,
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    }
  })
  .filter(Boolean)

const normalizedOutput = {
  generatedAt: new Date().toISOString(),
  source: 'LFV eAIP + LFV Digital AIM WFS',
  searchIndexSource: searchIndexPath,
  navaids,
  airspaceFrequencies: allAirspaceFrequencies,
  airportFrequencies: mergedAirportFrequencies,
  accSectors,
}

const outputDir = resolve('data/aviation/se/normalized')
const generatedDir = resolve('src/features/flightplan/generated')
mkdirSync(outputDir, { recursive: true })
mkdirSync(generatedDir, { recursive: true })

writeFileSync(
  resolve(outputDir, 'radio-nav.se.json'),
  JSON.stringify(normalizedOutput, null, 2),
)

writeFileSync(
  resolve(generatedDir, 'radio-nav.se.ts'),
  `export type SwedishNavaid = {
  id: string
  kind: 'VOR' | 'DMEV' | 'DME' | 'NDB'
  ident: string | null
  positionIndicator: string | null
  name: string | null
  lat: number
  lon: number
  frequency: string | null
  channel: string | null
  remarks: string | null
}

export type SwedishAirspaceFrequency = {
  id: string
  kind: 'FIR' | 'TMA' | 'TIA' | 'TIZ'
  name: string
  positionIndicator: string | null
  unit: string | null
  callSign: string | null
  frequencies: string[]
}

export type SwedishAirportFrequency = {
  id: string
  kind: string
  positionIndicator: string
  unit: string
  hours: string | null
  remarks: string | null
  frequencies: string[]
}

export type SwedishAccSector = {
  id: string
  sectorName: string
  sectorCode: string
  frequencyLabel: string
  frequencies: string[]
  upper: string | null
  lower: string | null
  remarks: string | null
  geometry: { type: 'Polygon'; coordinates: number[][][] }
}

export const swedishNavaids: SwedishNavaid[] = ${JSON.stringify(navaids, null, 2)}

export const swedishAirspaceFrequencies: SwedishAirspaceFrequency[] = ${JSON.stringify(allAirspaceFrequencies, null, 2)}

export const swedishAirportFrequencies: SwedishAirportFrequency[] = ${JSON.stringify(mergedAirportFrequencies, null, 2)}

export const swedishAccSectors: SwedishAccSector[] = ${JSON.stringify(accSectors, null, 2)}\n`,
)

console.log(
  `Parsed ${navaids.length} navaids, ${allAirspaceFrequencies.length} airspace frequency records, ${mergedAirportFrequencies.length} airport frequency records and ${accSectors.length} ACC sector polygons into ${resolve(outputDir, 'radio-nav.se.json')}`,
)
