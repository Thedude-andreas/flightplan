import { getSupabaseClient } from '../../lib/supabase/client'

export type ObstacleCategory =
  | 'wind_turbine'
  | 'mast'
  | 'tower'
  | 'chimney'
  | 'crane'
  | 'building'
  | 'vegetation'
  | 'powerline_or_pylon'
  | 'navaid'
  | 'other'

export type ObstacleBounds = {
  south: number
  west: number
  north: number
  east: number
}

export type SwedishObstacle = {
  id: string
  name: string | null
  category: ObstacleCategory
  typeDescription: string | null
  nationalTypeDescription: string | null
  lightingDescription: string | null
  markingDescription: string | null
  heightValue: number | null
  heightUnit: string | null
  mslValue: number | null
  mslUnit: string | null
  remark: string | null
  nationalRemark: string | null
  cycleId: string | null
  lat: number
  lon: number
}

type LfvObstacleFeature = {
  id?: string
  geometry?: {
    type?: string
    coordinates?: unknown
  } | null
  properties?: Record<string, unknown>
}

type LfvObstacleResponse = {
  features?: LfvObstacleFeature[]
  totalFeatures?: number | string
  numberMatched?: number | string
  numberReturned?: number | string
  timeStamp?: string
}

export type ObstacleFetchResult = {
  obstacles: SwedishObstacle[]
  totalFeatures: number | null
  numberReturned: number | null
  fetchedAt: string | null
}

const lfvWfsProxyPath = '/lfv-wfs'
const obstacleMaxFeatures = 2500

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function normalizeTypeText(...values: Array<string | null>) {
  return values
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function classifyObstacle(typeDescription: string | null, nationalTypeDescription: string | null): ObstacleCategory {
  const text = normalizeTypeText(typeDescription, nationalTypeDescription)

  if (/\bwind\b|\bvindkraft/.test(text)) return 'wind_turbine'
  if (/\bnavaid\b|\bloc\b|\bllz\b/.test(text)) return 'navaid'
  if (/\bcrane\b|\bkran\b/.test(text)) return 'crane'
  if (/\bchimney\b|\bskorsten\b|\bstack\b/.test(text)) return 'chimney'
  if (/\bpylon\b|\bpower line\b|\btransmission line\b|\bkraftledning/.test(text)) return 'powerline_or_pylon'
  if (/\bmast\b|\bantenna\b|\btelemast\b/.test(text)) return 'mast'
  if (/\btower\b|\btorn\b|\bspire\b/.test(text)) return 'tower'
  if (/\bbuilding\b|\bbyggnad\b|\bchurch\b|\bkyrka\b|\bsilo\b|\btank\b|\bgranary\b|\bmine hoist\b/.test(text)) return 'building'
  if (/\bforest\b|\btree\b|\bvegetation\b|\bshrub\b|\bskog\b/.test(text)) return 'vegetation'

  return 'other'
}

export function getObstacleCategoryLabel(category: ObstacleCategory) {
  switch (category) {
    case 'wind_turbine':
      return 'Vindkraftverk'
    case 'mast':
      return 'Mast'
    case 'tower':
      return 'Torn'
    case 'chimney':
      return 'Skorsten'
    case 'crane':
      return 'Kran'
    case 'building':
      return 'Byggnad'
    case 'vegetation':
      return 'Vegetation'
    case 'powerline_or_pylon':
      return 'Kraftledning/stolpe'
    case 'navaid':
      return 'Navigationshjälpmedel'
    case 'other':
      return 'Övrigt hinder'
  }
}

export function getObstacleDisplayType(obstacle: SwedishObstacle) {
  return obstacle.nationalTypeDescription ?? obstacle.typeDescription ?? getObstacleCategoryLabel(obstacle.category)
}

function toObstacle(feature: LfvObstacleFeature): SwedishObstacle | null {
  const coordinates = feature.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null
  }

  const lon = numberValue(coordinates[0])
  const lat = numberValue(coordinates[1])
  if (lat == null || lon == null) {
    return null
  }

  const properties = feature.properties ?? {}
  const idNumber = numberValue(properties.IDNR)
  const typeDescription = stringValue(properties.TYPE_DESC)
  const nationalTypeDescription = stringValue(properties.NATTYPE_DESC)

  return {
    id: String(idNumber ?? feature.id ?? `${lat.toFixed(6)},${lon.toFixed(6)}`),
    name: stringValue(properties.NAME),
    category: classifyObstacle(typeDescription, nationalTypeDescription),
    typeDescription,
    nationalTypeDescription,
    lightingDescription: stringValue(properties.LIGHTING_DESC) ?? stringValue(properties.NATLIGHTING_DESC),
    markingDescription: stringValue(properties.MARKING_DESC) ?? stringValue(properties.NATMARKING_DESC),
    heightValue: numberValue(properties.HEIGHT_VALUE),
    heightUnit: stringValue(properties.HEIGHT_UNIT),
    mslValue: numberValue(properties.MSL_VALUE),
    mslUnit: stringValue(properties.MSL_UNIT),
    remark: stringValue(properties.REMARK),
    nationalRemark: stringValue(properties.NATREMARK),
    cycleId: stringValue(properties.CYCLE_ID),
    lat,
    lon,
  }
}

function parseObstacleResponse(payload: LfvObstacleResponse): ObstacleFetchResult {
  return {
    obstacles: (payload.features ?? []).flatMap((feature) => {
      const obstacle = toObstacle(feature)
      return obstacle ? [obstacle] : []
    }),
    totalFeatures: numberValue(payload.totalFeatures ?? payload.numberMatched),
    numberReturned: numberValue(payload.numberReturned),
    fetchedAt: stringValue(payload.timeStamp),
  }
}

function clampLatitude(value: number) {
  return Math.max(-90, Math.min(90, value))
}

function clampLongitude(value: number) {
  return Math.max(-180, Math.min(180, value))
}

function normalizeBounds(bounds: ObstacleBounds): ObstacleBounds {
  return {
    south: clampLatitude(Math.min(bounds.south, bounds.north)),
    west: clampLongitude(Math.min(bounds.west, bounds.east)),
    north: clampLatitude(Math.max(bounds.south, bounds.north)),
    east: clampLongitude(Math.max(bounds.west, bounds.east)),
  }
}

function buildWfsParams(bounds: ObstacleBounds) {
  const normalized = normalizeBounds(bounds)
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.1.0',
    request: 'GetFeature',
    typeName: 'mais:OBSE',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    maxFeatures: String(obstacleMaxFeatures),
    bbox: [
      normalized.west.toFixed(6),
      normalized.south.toFixed(6),
      normalized.east.toFixed(6),
      normalized.north.toFixed(6),
      'EPSG:4326',
    ].join(','),
  })

  return params
}

async function fetchViaLocalProxy(bounds: ObstacleBounds, signal: AbortSignal) {
  const response = await fetch(`${lfvWfsProxyPath}?${buildWfsParams(bounds).toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`LFV flyghinder kunde inte laddas (${response.status}).`)
  }

  return parseObstacleResponse(await response.json() as LfvObstacleResponse)
}

export async function fetchSwedishObstacles(bounds: ObstacleBounds, signal: AbortSignal): Promise<ObstacleFetchResult> {
  const supabase = getSupabaseClient()

  if (supabase) {
    const { data, error } = await supabase.functions.invoke('lfv-obstacles', {
      body: { bounds: normalizeBounds(bounds), maxFeatures: obstacleMaxFeatures },
    })

    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    if (!error) {
      return parseObstacleResponse(data as LfvObstacleResponse)
    }
  }

  return fetchViaLocalProxy(bounds, signal)
}
