import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const POINT_LAYERS = [
  { typeName: 'mais:ECTR', kind: 'entry-exit', label: 'Entry/Exit point CTR' },
  { typeName: 'mais:VFRH', kind: 'holding', label: 'VFR Holdings' },
]

function normalizeText(value) {
  if (value == null) {
    return null
  }

  const normalized = String(value).replace(/\s+/g, ' ').trim()
  return normalized || null
}

function normalizeGeometryPoint(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null
  }

  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  }

  return null
}

function normalizeFeature(layer, feature, index) {
  const point = normalizeGeometryPoint(feature.geometry)
  if (!point) {
    return null
  }

  const properties = feature.properties ?? {}
  const id = properties.IDNR ?? properties.MSID ?? index + 1

  return {
    id: `${layer.kind}-${id}`,
    kind: layer.kind,
    sourceTypeName: layer.typeName,
    positionIndicator: normalizeText(properties.POSITIONINDICATOR),
    name: normalizeText(properties.NAMEOFPOINT),
    location: normalizeText(properties.LOCATION),
    comment: normalizeText([properties.COMMENT_1, properties.COMMENT_2].filter(Boolean).join(' ')),
    frequency: normalizeText(properties.FREQ),
    effectiveFrom: normalizeText(properties.WEF),
    lat: point.lat,
    lon: point.lon,
  }
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
      'User-Agent': 'VFRplan/1.0 (+https://vfrplan.se/)',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${layer.typeName}: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const points = (data.features ?? [])
    .map((feature, index) => normalizeFeature(layer, feature, index))
    .filter(Boolean)

  return {
    layer,
    featureCount: points.length,
    points,
  }
}

const layerResults = await Promise.all(POINT_LAYERS.map(fetchLayer))
const visualPoints = layerResults
  .flatMap((result) => result.points)
  .sort((left, right) =>
    (left.positionIndicator ?? '').localeCompare(right.positionIndicator ?? '', 'sv') ||
    (left.kind ?? '').localeCompare(right.kind ?? '', 'sv') ||
    (left.name ?? '').localeCompare(right.name ?? '', 'sv') ||
    left.lat - right.lat ||
    left.lon - right.lon,
  )

const normalizedOutput = {
  generatedAt: new Date().toISOString(),
  source: 'LFV Digital AIM WFS',
  serviceUrl: 'https://daim.lfv.se/geoserver/ows',
  layers: layerResults.map((result) => ({
    typeName: result.layer.typeName,
    kind: result.layer.kind,
    label: result.layer.label,
    count: result.featureCount,
  })),
  count: visualPoints.length,
  visualPoints,
}

const outputDir = resolve('data/aviation/se/normalized')
const publicDataDir = resolve('public/vfrplan-data')
const generatedDir = resolve('src/features/flightplan/generated')
mkdirSync(outputDir, { recursive: true })
mkdirSync(publicDataDir, { recursive: true })
mkdirSync(generatedDir, { recursive: true })

writeFileSync(resolve(outputDir, 'visual-points.se.json'), `${JSON.stringify(normalizedOutput, null, 2)}\n`)
writeFileSync(resolve(publicDataDir, 'visual-points.se.json'), `${JSON.stringify(visualPoints, null, 2)}\n`)
writeFileSync(
  resolve(generatedDir, 'visual-points.se.ts'),
  `export type SwedishVisualPoint = {
  id: string
  kind: 'entry-exit' | 'holding'
  sourceTypeName: string
  positionIndicator: string | null
  name: string | null
  location: string | null
  comment: string | null
  frequency: string | null
  effectiveFrom: string | null
  lat: number
  lon: number
}

export const swedishVisualPoints: SwedishVisualPoint[] = ${JSON.stringify(visualPoints, null, 2)}\n`,
)

console.log(
  `Parsed ${visualPoints.length} Swedish VFR entry/exit and holding points from LFV WFS into ${resolve(outputDir, 'visual-points.se.json')}`,
)
