import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const inputDir = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE')
const outputPath = resolve('data/aviation/se/normalized/lfv-manifest.json')

function walk(dir, collected = []) {
  for (const name of readdirSync(dir)) {
    const absolutePath = resolve(dir, name)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      walk(absolutePath, collected)
    } else {
      collected.push(absolutePath)
    }
  }
  return collected
}

function classify(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').toUpperCase()

  if (normalized.includes('/AD/') || normalized.includes('ES_AD_')) {
    return 'aerodrome'
  }
  if (normalized.includes('/ENR/') || normalized.includes('ES_ENR_')) {
    return 'enroute'
  }
  if (normalized.includes('/GEN/') || normalized.includes('ES_GEN_')) {
    return 'general'
  }
  return 'other'
}

const files = walk(inputDir).map((absolutePath) => {
  const relativePath = relative(inputDir, absolutePath)
  return {
    path: relativePath.replaceAll('\\', '/'),
    section: classify(relativePath),
  }
})

const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'LFV AIP Offline',
  counts: {
    total: files.length,
    aerodrome: files.filter((file) => file.section === 'aerodrome').length,
    enroute: files.filter((file) => file.section === 'enroute').length,
    general: files.filter((file) => file.section === 'general').length,
    other: files.filter((file) => file.section === 'other').length,
  },
  files,
}

mkdirSync(resolve('data/aviation/se/normalized'), { recursive: true })
writeFileSync(outputPath, JSON.stringify(manifest, null, 2))

console.log(`Wrote manifest to ${outputPath}`)
