import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const airports = readJson('data/aviation/se/normalized/airports.se.json')
const airspaces = readJson('data/aviation/se/normalized/airspaces.se.json')
const places = readJson('data/aviation/se/normalized/places.se.json')
const radioNav = readJson('data/aviation/se/normalized/radio-nav.se.json')
const index = readJson('data/aviation/se/normalized/aviation.se.index.json')

assert((airports.airports ?? []).length >= 40, 'Airport count unexpectedly low')
assert((airspaces.airspaces ?? []).length >= 250, 'Airspace count unexpectedly low')
assert((places.places ?? []).length >= 10000, 'Place count unexpectedly low')
assert((radioNav.navaids ?? []).length >= 100, 'Navaid count unexpectedly low')
assert((radioNav.airportFrequencies ?? []).length >= 100, 'Airport frequency count unexpectedly low')
assert((radioNav.airspaceFrequencies ?? []).length >= 100, 'Airspace frequency count unexpectedly low')
assert((radioNav.accSectors ?? []).length >= 20, 'ACC sector count unexpectedly low')

const requiredAirports = new Set(['ESSA', 'ESSB', 'ESNU', 'ESPA', 'ESNS', 'ESNQ'])
for (const icao of requiredAirports) {
  assert(
    (airports.airports ?? []).some((airport) => airport.icao === icao),
    `Missing required airport ${icao}`,
  )
}

const requiredAirspaceKinds = ['CTR', 'TMA', 'TIA', 'TIZ', 'R', 'D']
for (const kind of requiredAirspaceKinds) {
  assert(
    (airspaces.airspaces ?? []).some((airspace) => airspace.kind === kind),
    `Missing required airspace kind ${kind}`,
  )
}

const accSectorK = (radioNav.accSectors ?? []).find((sector) => sector.sectorName === 'ESOS ACC sector K')
assert(accSectorK, 'Missing ESOS ACC sector K')
assert(accSectorK.frequencies.includes('131.055'), 'ESOS ACC sector K missing 131.055')

const arlandaGround = (radioNav.airportFrequencies ?? []).find(
  (record) => record.positionIndicator === 'ESSA' && /GROUND/i.test(record.unit),
)
assert(arlandaGround, 'Missing ESSA ground frequency')

const umeaTowerPrimary = (radioNav.airportFrequencies ?? []).find(
  (record) =>
    record.positionIndicator === 'ESNU' &&
    record.unit === 'UMEÅ TOWER' &&
    record.frequencies.includes('119.805'),
)
assert(umeaTowerPrimary, 'Missing ESNU primary tower frequency')

const emergencyRows = (radioNav.airportFrequencies ?? []).filter((record) => record.frequencies.includes('121.500'))
assert(emergencyRows.length > 0, 'Expected to keep 121.500 in raw airport frequency dataset for traceability')

assert((index.accSectors ?? []).length === (radioNav.accSectors ?? []).length, 'Index accSectors out of sync')
assert((index.airports ?? []).length === (airports.airports ?? []).length, 'Index airports out of sync')
assert((index.airspaces ?? []).length === (airspaces.airspaces ?? []).length, 'Index airspaces out of sync')

console.log('Swedish aviation data validation passed.')
