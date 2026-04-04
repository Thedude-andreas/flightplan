import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifestPath = resolve('data/aviation/se/normalized/lfv-manifest.json')
const outputDir = resolve('data/aviation/se/normalized')
const airportsPath = resolve(outputDir, 'airports.se.json')
const airspacesPath = resolve(outputDir, 'airspaces.se.json')
const placesPath = resolve(outputDir, 'places.se.json')
const radioNavPath = resolve(outputDir, 'radio-nav.se.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const parsedAirports = existsSync(airportsPath) ? JSON.parse(readFileSync(airportsPath, 'utf8')) : null
const parsedAirspaces = existsSync(airspacesPath) ? JSON.parse(readFileSync(airspacesPath, 'utf8')) : null
const parsedPlaces = existsSync(placesPath) ? JSON.parse(readFileSync(placesPath, 'utf8')) : null
const parsedRadioNav = existsSync(radioNavPath) ? JSON.parse(readFileSync(radioNavPath, 'utf8')) : null

const output = {
  generatedAt: new Date().toISOString(),
  source: 'LFV AIP Offline',
  manifestCounts: manifest?.counts ?? null,
  airports: parsedAirports?.airports ?? [],
  airspaces: parsedAirspaces?.airspaces ?? [],
  places: parsedPlaces?.places ?? [],
  navaids: parsedRadioNav?.navaids ?? [],
  airspaceFrequencies: parsedRadioNav?.airspaceFrequencies ?? [],
  airportFrequencies: parsedRadioNav?.airportFrequencies ?? [],
  accSectors: parsedRadioNav?.accSectors ?? [],
  notes: [
    'This file is the normalized entry point for Swedish aviation data in AMC.',
    'Current step indexes official LFV AIP content and prepares stable output files.',
    'Current airport list is parsed from LFV AD 1.1. Airspace polygons are fetched from LFV Digital AIM WFS.',
    'Swedish place labels are currently built from GeoNames Sweden for settlements, lakes, islands and mountains.',
    'Radio/NAV suggestions are derived from LFV eAIP search index plus LFV WFS navaid layers.',
  ],
}

mkdirSync(outputDir, { recursive: true })
if (!parsedAirports) {
  writeFileSync(resolve(outputDir, 'airports.se.json'), JSON.stringify(output.airports, null, 2))
}
if (!parsedAirspaces) {
  writeFileSync(resolve(outputDir, 'airspaces.se.json'), JSON.stringify(output.airspaces, null, 2))
}
if (!parsedPlaces) {
  writeFileSync(resolve(outputDir, 'places.se.json'), JSON.stringify(output.places, null, 2))
}
writeFileSync(resolve(outputDir, 'navaids.se.json'), JSON.stringify(output.navaids, null, 2))
writeFileSync(resolve(outputDir, 'airspace-frequencies.se.json'), JSON.stringify(output.airspaceFrequencies, null, 2))
writeFileSync(resolve(outputDir, 'airport-frequencies.se.json'), JSON.stringify(output.airportFrequencies, null, 2))
writeFileSync(resolve(outputDir, 'acc-sectors.se.json'), JSON.stringify(output.accSectors, null, 2))
writeFileSync(resolve(outputDir, 'aviation.se.index.json'), JSON.stringify(output, null, 2))

console.log(`Wrote normalized placeholder datasets to ${outputDir}`)
