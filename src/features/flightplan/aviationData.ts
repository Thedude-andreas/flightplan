import { swedishAirports as embeddedAirports } from './generated/airports.se'
import { swedishAirspaces as embeddedAirspaces } from './generated/airspaces.se'
import { swedishNavaids as embeddedNavaids } from './generated/radio-nav.se'
import { swedishVisualPoints as embeddedVisualPoints } from './generated/visual-points.se'

const previewDataBaseUrlParam = 'aviationDataBaseUrl'

function normalizeDataBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function getConfiguredDataBaseUrl() {
  const configuredUrl = import.meta.env.VITE_AVIATION_DATA_BASE_URL?.trim()
  if (configuredUrl) {
    return normalizeDataBaseUrl(configuredUrl)
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (supabaseUrl) {
    return normalizeDataBaseUrl(`${supabaseUrl}/storage/v1/object/public/aviation-data/current`)
  }

  return normalizeDataBaseUrl(`${import.meta.env.BASE_URL}vfrplan-data`)
}

export function getSwedishAviationDataBaseUrl() {
  if (typeof window === 'undefined') {
    return getConfiguredDataBaseUrl()
  }

  const params = new URLSearchParams(window.location.search)
  const previewUrl = params.get(previewDataBaseUrlParam)?.trim()
  if (previewUrl && /^https?:\/\//i.test(previewUrl)) {
    return normalizeDataBaseUrl(previewUrl)
  }

  return getConfiguredDataBaseUrl()
}

export type SwedishAirspaceGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

export type SwedishAirspace = {
  id: string
  kind: 'CTR' | 'TMA' | 'TIA' | 'TIZ' | 'R' | 'D' | 'ATZ' | 'TRA'
  name: string | null
  positionIndicator: string | null
  location: string | null
  lower: string | null
  upper: string | null
  effectiveFrom: string | null
  sourceTypeName: string
  geometry: SwedishAirspaceGeometry
}

export type SwedishAirport = {
  icao: string | null
  name: string | null
  lat: number
  lon: number
  elevationFt?: number | null
  category: string | null
  detailsInAd2: boolean
  runways: Array<{
    designator: string
    dimensionsMeters: string | null
    surface: string | null
  }>
}

export type SwedishNavaid = {
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

export type SwedishVisualPoint = {
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

const holdingDirectionLabels = new Set(['NORTH', 'SOUTH', 'EAST', 'WEST'])

export function getSwedishVisualPointDisplayLabel(point: SwedishVisualPoint) {
  if (point.kind === 'holding') {
    const location = point.location?.trim().toUpperCase()
    if (location && holdingDirectionLabels.has(location)) {
      return location
    }

    return point.location ?? point.name ?? point.positionIndicator ?? 'HOLD'
  }

  return point.location ?? point.name ?? point.positionIndicator ?? 'ENTRY'
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

type SwedishAirportsPayload = {
  airports: Array<{
    icao: string | null
    name: string | null
    category: string | null
    detailsInAd2: boolean
    elevationFt?: number | null
    runways?: SwedishAirport['runways']
    arp: {
      lat: number
      lon: number
    }
  }>
}

type SwedishAirspacesPayload = {
  airspaces: SwedishAirspace[]
}

type SwedishRadioNavPayload = {
  navaids: SwedishNavaid[]
}

type SwedishVisualPointsPayload = SwedishVisualPoint[] | {
  visualPoints: SwedishVisualPoint[]
}

type SwedishAviationData = {
  airports: SwedishAirport[]
  airspaces: SwedishAirspace[]
  navaids: SwedishNavaid[]
  visualPoints: SwedishVisualPoint[]
  airspaceFrequencies: SwedishAirspaceFrequency[]
  airportFrequencies: SwedishAirportFrequency[]
  accSectors: SwedishAccSector[]
}

let aviationData: SwedishAviationData | null = null
let aviationDataPromise: Promise<SwedishAviationData> | null = null

async function fetchJson<T>(path: string, fallback?: () => T) {
  const response = await fetch(`${getSwedishAviationDataBaseUrl()}/${path}`)
  if (!response.ok) {
    if (fallback) {
      return fallback()
    }

    throw new Error(`Kunde inte ladda ${path} (${response.status}).`)
  }

  return response.json() as Promise<T>
}

function toSwedishAirports(payload: SwedishAirportsPayload): SwedishAirport[] {
  return payload.airports.map((airport) => ({
    icao: airport.icao,
    name: airport.name,
    lat: airport.arp.lat,
    lon: airport.arp.lon,
    elevationFt: airport.elevationFt ?? null,
    category: airport.category,
    detailsInAd2: airport.detailsInAd2,
    runways: airport.runways ?? [],
  }))
}

function toSwedishVisualPoints(payload: SwedishVisualPointsPayload): SwedishVisualPoint[] {
  return Array.isArray(payload) ? payload : payload.visualPoints ?? []
}

function requireAviationData() {
  if (!aviationData) {
    throw new Error('Svenska flygdata är inte laddade ännu.')
  }

  return aviationData
}

export async function preloadSwedishAviationData() {
  if (aviationData) {
    return aviationData
  }

  if (!aviationDataPromise) {
    aviationDataPromise = Promise.all([
      fetchJson<SwedishAirportsPayload>('airports.se.json', () => ({
        airports: embeddedAirports.map((airport) => ({
          icao: airport.icao,
          name: airport.name,
          category: airport.category,
          detailsInAd2: airport.detailsInAd2,
          elevationFt: null,
          runways: airport.runways,
          arp: {
            lat: airport.lat,
            lon: airport.lon,
          },
        })),
      })),
      fetchJson<SwedishAirspacesPayload>('airspaces.se.json', () => ({
        airspaces: embeddedAirspaces,
      })),
      fetchJson<SwedishRadioNavPayload>('radio-nav.se.json', () => ({
        navaids: embeddedNavaids,
      })),
      fetchJson<SwedishVisualPointsPayload>('visual-points.se.json', () => embeddedVisualPoints),
      fetchJson<SwedishAirspaceFrequency[]>('airspace-frequencies.se.json'),
      fetchJson<SwedishAirportFrequency[]>('airport-frequencies.se.json'),
      fetchJson<SwedishAccSector[]>('acc-sectors.se.json'),
    ])
      .then(([airportsPayload, airspacesPayload, radioNavPayload, visualPoints, airspaceFrequencies, airportFrequencies, accSectors]) => {
        aviationData = {
          airports: toSwedishAirports(airportsPayload),
          airspaces: airspacesPayload.airspaces,
          navaids: radioNavPayload.navaids,
          visualPoints: toSwedishVisualPoints(visualPoints),
          airspaceFrequencies,
          airportFrequencies,
          accSectors,
        }

        return aviationData
      })
      .finally(() => {
        aviationDataPromise = null
      })
  }

  return aviationDataPromise
}

export function getSwedishAirports() {
  return requireAviationData().airports
}

export function getSwedishAirspaces() {
  return requireAviationData().airspaces
}

export function getSwedishNavaids() {
  return requireAviationData().navaids
}

export function getSwedishVisualPoints() {
  return requireAviationData().visualPoints
}

export function getSwedishAirspaceFrequencies() {
  return requireAviationData().airspaceFrequencies
}

export function getSwedishAirportFrequencies() {
  return requireAviationData().airportFrequencies
}

export function getSwedishAccSectors() {
  return requireAviationData().accSectors
}
