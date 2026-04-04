import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const reportPath = process.argv[2] ? resolve(process.argv[2]) : null

const trackedFiles = [
  'data/aviation/se/normalized/airports.se.json',
  'data/aviation/se/normalized/airspaces.se.json',
  'data/aviation/se/normalized/places.se.json',
  'data/aviation/se/normalized/navaids.se.json',
  'data/aviation/se/normalized/airspace-frequencies.se.json',
  'data/aviation/se/normalized/airport-frequencies.se.json',
  'data/aviation/se/normalized/acc-sectors.se.json',
  'data/aviation/se/normalized/radio-nav.se.json',
  'data/aviation/se/normalized/aviation.se.index.json',
]

function readWorkingJson(path) {
  return existsSync(resolve(path)) ? JSON.parse(readFileSync(resolve(path), 'utf8')) : null
}

function readHeadJson(path) {
  try {
    const output = execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
    return JSON.parse(output)
  } catch {
    return null
  }
}

function summarize(path, current, previous) {
  const currentCount =
    current?.count ??
    current?.airports?.length ??
    current?.airspaces?.length ??
    current?.places?.length ??
    current?.navaids?.length ??
    current?.airportFrequencies?.length ??
    current?.airspaceFrequencies?.length ??
    current?.accSectors?.length ??
    null

  const previousCount =
    previous?.count ??
    previous?.airports?.length ??
    previous?.airspaces?.length ??
    previous?.places?.length ??
    previous?.navaids?.length ??
    previous?.airportFrequencies?.length ??
    previous?.airspaceFrequencies?.length ??
    previous?.accSectors?.length ??
    null

  return `- \`${path}\`: ${previousCount ?? 'new'} -> ${currentCount ?? 'n/a'}`
}

const changedFiles = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', ...trackedFiles], {
  encoding: 'utf8',
}).split('\n').filter(Boolean)

const lines = ['# Swedish aviation data diff', '']

if (changedFiles.length === 0) {
  lines.push('No normalized aviation data files changed.')
} else {
  lines.push('## Changed datasets', '')
  for (const path of changedFiles) {
    lines.push(summarize(path, readWorkingJson(path), readHeadJson(path)))
  }
}

const report = `${lines.join('\n')}\n`

if (reportPath) {
  writeFileSync(reportPath, report)
} else {
  process.stdout.write(report)
}
