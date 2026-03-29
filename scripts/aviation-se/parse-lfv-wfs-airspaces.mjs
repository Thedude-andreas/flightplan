import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const AIRSPACE_LAYERS = [
  { typeName: 'mais:CTR', kind: 'CTR', label: 'CTR' },
  { typeName: 'mais:TMAW', kind: 'TMA', label: 'TMA' },
  { typeName: 'mais:ATZ', kind: 'ATZ', label: 'ATZ' },
  { typeName: 'mais:TRA', kind: 'TRA', label: 'TRA' },
]

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
const airspaces = layerResults.flatMap((result) => result.features)

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
  kind: 'CTR' | 'TMA' | 'ATZ' | 'TRA'
  name: string | null
  positionIndicator: string | null
  location: string | null
  lower: string | null
  upper: string | null
  effectiveFrom: string | null
  sourceTypeName: string
  geometry: SwedishAirspaceGeometry
}

export const swedishAirspaces: SwedishAirspace[] = ${JSON.stringify(airspaces, null, 2)}\n`,
)

console.log(
  `Parsed ${airspaces.length} Swedish airspace features from LFV WFS into ${resolve(outputDir, 'airspaces.se.json')}`,
)
