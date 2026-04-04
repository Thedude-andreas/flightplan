import { execFileSync } from 'node:child_process'

const steps = [
  ['node', ['./scripts/aviation-se/fetch-lfv-aip.mjs']],
  ['node', ['./scripts/aviation-se/extract-lfv-aip.mjs']],
  ['node', ['./scripts/aviation-se/build-manifest.mjs']],
  ['node', ['./scripts/aviation-se/parse-ad-1.1-airports.mjs']],
  ['node', ['./scripts/aviation-se/parse-lfv-wfs-airspaces.mjs']],
  ['node', ['./scripts/aviation-se/parse-lfv-radio-nav.mjs']],
  ['node', ['./scripts/aviation-se/parse-geonames-places.mjs']],
  ['node', ['./scripts/aviation-se/build-reference-data.mjs']],
]

for (const [command, args] of steps) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    stdio: 'inherit',
  })
}

console.log('\nSwedish aviation data refresh completed.')
