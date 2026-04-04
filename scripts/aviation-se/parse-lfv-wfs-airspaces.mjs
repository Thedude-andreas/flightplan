import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const AIRSPACE_LAYERS = [
  { typeName: 'mais:CTR', kind: 'CTR', label: 'CTR' },
  { typeName: 'mais:TMAW', kind: 'TMA', label: 'TMA' },
  { typeName: 'mais:TIA', kind: 'TIA', label: 'TIA' },
  { typeName: 'mais:TIZ', kind: 'TIZ', label: 'TIZ' },
  { typeName: 'mais:ATZ', kind: 'ATZ', label: 'ATZ' },
  { typeName: 'mais:TRA', kind: 'TRA', label: 'TRA' },
]
const cachedSearchIndexPath = resolve('data/aviation/se/raw/lfv/searchIndex.current.js')

function normalizeGeometry(geometry) {
  if (!geometry || !geometry.type || !Array.isArray(geometry.coordinates)) {
    return null
  }

  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }

  return {
    type: geometry.type,
    coordinates: geometry.coordinates,
  }
}

function normalizeFeature(layer, feature, index) {
  const geometry = normalizeGeometry(feature.geometry)
  if (!geometry) {
    return null
  }

  const properties = feature.properties ?? {}

  return {
    id: `${layer.kind}-${properties.MSID ?? properties.IDNR ?? index + 1}`,
    kind: layer.kind,
    name: properties.NAMEOFAREA ?? null,
    positionIndicator: properties.POSITIONINDICATOR ?? null,
    location: properties.LOCATION ?? null,
    lower: properties.LOWER ?? null,
    upper: properties.UPPER ?? null,
    effectiveFrom: properties.WEF ?? null,
    sourceTypeName: layer.typeName,
    geometry,
  }
}

function normalizeAirspaceName(value) {
  return value?.replace(/\s+/g, ' ').trim() ?? null
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

  return [lon, lat]
}

function decodeJsString(value) {
  return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
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

function looksLikeLateralLimit(value) {
  return /\d{6}[NS]\d{7}[EW]/.test(value) || /A circle with radius/i.test(value)
}

function looksLikeVerticalLimit(value) {
  return /(?:FL\s*\d+|\d+\s*ft\s*AMSL|GND|SFC|UNL)/i.test(value)
}

function parseVerticalLimits(value) {
  const normalized = value.replaceAll('\\/', '/').replace(/\s+/g, ' ').trim()
  const parts = normalized.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) {
    return { lower: null, upper: null }
  }

  return {
    upper: parts[0].replace(/\s+Class\s+[A-Z]$/i, '').trim(),
    lower: parts[1].replace(/\s+Class\s+[A-Z]$/i, '').trim(),
  }
}

function buildCirclePolygon(center, radiusNm, points = 72) {
  const [centerLon, centerLat] = center
  const latRadians = (centerLat * Math.PI) / 180
  const deltaLat = radiusNm / 60
  const deltaLon = radiusNm / (60 * Math.max(Math.cos(latRadians), 0.01))
  const ring = []

  for (let index = 0; index < points; index += 1) {
    const angle = (Math.PI * 2 * index) / points
    ring.push([
      centerLon + deltaLon * Math.cos(angle),
      centerLat + deltaLat * Math.sin(angle),
    ])
  }

  if (ring.length > 0) {
    ring.push([...ring[0]])
  }

  return ring
}

function parseSectorGeometry(lateralLimits) {
  const normalized = lateralLimits.replaceAll('\\/', '/').replace(/\s+/g, ' ').trim()

  const circleMatch = normalized.match(
    /A circle with radius ([\d.]+) NM centred on (\d{6})([NS])(\d{7})([EW])/i,
  )
  if (circleMatch) {
    return {
      type: 'Polygon',
      coordinates: [buildCirclePolygon(
        dmsToDecimal(circleMatch[2], circleMatch[3], circleMatch[4], circleMatch[5]),
        Number(circleMatch[1]),
      )],
    }
  }

  let compact = normalized.replace(/\s+/g, '')
  compact = compact.replace(/to point of origin\./gi, '')
  compact = compact.replace(/clockwisealonganarc[^-]*centredon\d{6}[NS]\d{7}[EW]-?/gi, '')
  compact = compact.replace(/counterclockwisealonganarc[^-]*centredon\d{6}[NS]\d{7}[EW]-?/gi, '')
  compact = compact.replace(/alongtheFIRBDRYto/gi, '-')

  const coordinates = [...compact.matchAll(/(\d{6})([NS])(\d{7})([EW])/g)].map((match) =>
    dmsToDecimal(match[1], match[2], match[3], match[4]),
  )

  if (coordinates.length < 3) {
    return null
  }

  const ring = [...coordinates]
  const [firstLon, firstLat] = ring[0]
  const [lastLon, lastLat] = ring[ring.length - 1]
  if (firstLon !== lastLon || firstLat !== lastLat) {
    ring.push([firstLon, firstLat])
  }

  return {
    type: 'Polygon',
    coordinates: [ring],
  }
}

function parseTmaSectors(searchIndexSource, airspaces) {
  const enrBody = extractSearchIndexBody(searchIndexSource, 'ES-ENR 2.1-sv-SE.html')
  if (!enrBody) {
    return { source: null, sectorsByName: new Map() }
  }

  const tokens = enrBody.split(',').map((token) => token.trim())
  const tmaStart = tokens.indexOf('3 Förteckning över TMA')
  const tmaEnd = tokens.indexOf('4 Förteckning över TIA')
  if (tmaStart < 0 || tmaEnd < 0 || tmaEnd <= tmaStart) {
    return { source: 'LFV ENR 2.1 search index', sectorsByName: new Map() }
  }

  const baseNames = [...new Set(
    airspaces
      .filter((airspace) => airspace.kind === 'TMA')
      .map((airspace) => normalizeAirspaceName(airspace.name))
      .filter(Boolean),
  )]
  const baseNameSet = new Set(baseNames)
  const sectorsByName = new Map()

  let index = tmaStart + 25
  while (index < tmaEnd) {
    const baseName = normalizeAirspaceName(tokens[index])
    if (!baseNameSet.has(baseName)) {
      index += 1
      continue
    }

    index += 1
    const sectors = []

    while (index < tmaEnd) {
      const token = normalizeAirspaceName(tokens[index])
      if (baseNameSet.has(token)) {
        break
      }

      let sectionName = token
      let lateralLimits = tokens[index + 1] ?? ''
      let verticalLimits = tokens[index + 2] ?? ''
      let scanIndex = index + 3

      if (looksLikeLateralLimit(token)) {
        sectionName = baseName
        lateralLimits = tokens[index] ?? ''
        verticalLimits = tokens[index + 1] ?? ''
        scanIndex = index + 2
      }

      if (looksLikeLateralLimit(lateralLimits) && looksLikeVerticalLimit(verticalLimits)) {
        const geometry = parseSectorGeometry(lateralLimits)
        const { lower, upper } = parseVerticalLimits(verticalLimits)
        if (geometry && (lower || upper)) {
          sectors.push({
            id: `${baseName}-${sectors.length + 1}`,
            name: sectionName ?? baseName,
            lower,
            upper,
            geometry,
          })
        }
      }

      while (scanIndex < tmaEnd) {
        const nextToken = normalizeAirspaceName(tokens[scanIndex])
        if (baseNameSet.has(nextToken) || nextToken === baseName || nextToken?.startsWith(`${baseName} `)) {
          break
        }
        scanIndex += 1
      }

      index = scanIndex
    }

    if (sectors.length > 0) {
      sectorsByName.set(baseName, sectors)
    }
  }

  return { source: 'LFV ENR 2.1 search index', sectorsByName }
}

async function fetchLayer(layer) {
  const url = new URL('https://daim.lfv.se/geoserver/ows')
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
  const normalized = (data.features ?? [])
    .map((feature, index) => normalizeFeature(layer, feature, index))
    .filter(Boolean)

  return {
    layer,
    featureCount: normalized.length,
    features: normalized,
  }
}

const layerResults = await Promise.all(AIRSPACE_LAYERS.map(fetchLayer))
const baseAirspaces = layerResults.flatMap((result) => result.features)
const { body: searchIndexSource, source: searchIndexPath } = await loadSearchIndexSource()
const { sectorsByName, source: tmaSectorSource } = parseTmaSectors(searchIndexSource, baseAirspaces)
const airspaces = baseAirspaces.map((airspace) => {
  const normalizedName = normalizeAirspaceName(airspace.name)
  const sectors = airspace.kind === 'TMA' ? sectorsByName.get(normalizedName) ?? [] : []

  return sectors.length > 0
    ? { ...airspace, tmaSectors: sectors }
    : airspace
})

const normalizedOutput = {
  generatedAt: new Date().toISOString(),
  source: 'LFV Digital AIM WFS',
  serviceUrl: 'https://daim.lfv.se/geoserver/ows',
  tmaSectorSource: tmaSectorSource ? {
    document: tmaSectorSource,
    path: searchIndexPath,
  } : null,
  layers: layerResults.map((result) => ({
    typeName: result.layer.typeName,
    kind: result.layer.kind,
    label: result.layer.label,
    count: result.featureCount,
  })),
  count: airspaces.length,
  airspaces,
}

const outputDir = resolve('data/aviation/se/normalized')
const generatedDir = resolve('src/features/flightplan/generated')
mkdirSync(outputDir, { recursive: true })
mkdirSync(generatedDir, { recursive: true })

writeFileSync(
  resolve(outputDir, 'airspaces.se.json'),
  JSON.stringify(normalizedOutput, null, 2),
)

writeFileSync(
  resolve(generatedDir, 'airspaces.se.ts'),
  `export type SwedishAirspaceGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

export type SwedishAirspace = {
  id: string
  kind: 'CTR' | 'TMA' | 'TIA' | 'TIZ' | 'ATZ' | 'TRA'
  name: string | null
  positionIndicator: string | null
  location: string | null
  lower: string | null
  upper: string | null
  effectiveFrom: string | null
  sourceTypeName: string
  geometry: SwedishAirspaceGeometry
  tmaSectors?: Array<{
    id: string
    name: string
    lower: string | null
    upper: string | null
    geometry: SwedishAirspaceGeometry
  }>
}

export const swedishAirspaces: SwedishAirspace[] = ${JSON.stringify(airspaces, null, 2)}\n`,
)

console.log(
  `Parsed ${airspaces.length} Swedish airspace features from LFV WFS into ${resolve(outputDir, 'airspaces.se.json')}`,
)
