import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const zipPath = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE.zip')
const outputDir = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE')

if (!existsSync(zipPath)) {
  console.error(`Missing archive: ${zipPath}`)
  console.error('Run `npm run aviation:se:fetch` first.')
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })

if (process.argv.includes('--clean')) {
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
}

const unzip = spawnSync('unzip', ['-o', '-q', zipPath, '-d', outputDir], {
  stdio: 'inherit',
})

if (unzip.status !== 0) {
  process.exit(unzip.status ?? 1)
}

console.log(`Extracted LFV AIP offline package to ${outputDir}`)
