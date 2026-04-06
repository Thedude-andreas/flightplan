import { swedishAirports as embeddedAirports } from './generated/airports.se'
import { swedishAirspaces as embeddedAirspaces } from './generated/airspaces.se'
import { swedishNavaids as embeddedNavaids } from './generated/radio-nav.se'

const dataBaseUrl = `${import.meta.env.BASE_URL}vfrplan-data`

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
  category: string | null
  detailsInAd2: boolean
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

type SwedishAviationData = {
  airports: SwedishAirport[]
  airspaces: SwedishAirspace[]
  navaids: SwedishNavaid[]
  airspaceFrequencies: SwedishAirspaceFrequency[]
  airportFrequencies: SwedishAirportFrequency[]
  accSectors: SwedishAccSector[]
}

let aviationData: SwedishAviationData | null = null
let aviationDataPromise: Promise<SwedishAviationData> | null = null

async function fetchJson<T>(path: string, fallback?: () => T) {
  const response = await fetch(`${dataBaseUrl}/${path}`)
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
    category: airport.category,
    detailsInAd2: airport.detailsInAd2,
  }))
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
      fetchJson<SwedishAirspaceFrequency[]>('airspace-frequencies.se.json'),
      fetchJson<SwedishAirportFrequency[]>('airport-frequencies.se.json'),
      fetchJson<SwedishAccSector[]>('acc-sectors.se.json'),
    ])
      .then(([airportsPayload, airspacesPayload, radioNavPayload, airspaceFrequencies, airportFrequencies, accSectors]) => {
        aviationData = {
          airports: toSwedishAirports(airportsPayload),
          airspaces: airspacesPayload.airspaces,
          navaids: radioNavPayload.navaids,
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

export function getSwedishAirspaceFrequencies() {
  return requireAviationData().airspaceFrequencies
}

export function getSwedishAirportFrequencies() {
  return requireAviationData().airportFrequencies
}

export function getSwedishAccSectors() {
  return requireAviationData().accSectors
}
