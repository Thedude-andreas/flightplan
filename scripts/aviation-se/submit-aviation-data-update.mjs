import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const dataFiles = [
  'acc-sectors.se.json',
  'airport-frequencies.se.json',
  'airports.se.json',
  'airspace-frequencies.se.json',
  'airspaces.se.json',
  'places.se.json',
  'radio-nav.se.json',
]

const generatedFiles = [
  'public/vfrplan-data/places.se.json',
  'src/features/flightplan/generated/airports.se.ts',
  'src/features/flightplan/generated/airspaces.se.ts',
  'src/features/flightplan/generated/places.se.ts',
  'src/features/flightplan/generated/radio-nav.se.ts',
]

const normalizedFiles = [
  ...dataFiles.map((fileName) => `data/aviation/se/normalized/${fileName}`),
  'data/aviation/se/normalized/aviation.se.index.json',
  'data/aviation/se/normalized/navaids.se.json',
  'data/aviation/se/normalized/lfv-manifest.json',
]

function parseArgs() {
  return new Set(process.argv.slice(2))
}

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing ${name}.`)
  }

  return value
}

function optionalEnv(name, fallback) {
  return process.env[name]?.trim() || fallback
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  return `{${Object.entries(value)
    .filter(([key]) => key !== 'generatedAt' && key !== 'source' && key !== 'inputPath' && key !== 'ad2Source' && key !== 'sourceUrl')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function makeToken() {
  return randomBytes(32).toString('base64url')
}

function snapshot(paths) {
  return new Map(paths.map((path) => {
    const absolutePath = resolve(path)
    return [
      path,
      existsSync(absolutePath)
        ? { exists: true, content: readFileSync(absolutePath), mode: statSync(absolutePath).mode }
        : { exists: false, content: null },
    ]
  }))
}

function restore(snapshotMap) {
  for (const [path, entry] of snapshotMap) {
    const absolutePath = resolve(path)
    if (entry.exists) {
      writeFileSync(absolutePath, entry.content)
      chmodSync(absolutePath, entry.mode)
    } else if (existsSync(absolutePath)) {
      rmSync(absolutePath)
    }
  }
}

function normalizePlaceKind(kind) {
  if (kind === 's') return 'settlement'
  if (kind === 'l') return 'lake'
  if (kind === 'i') return 'island'
  if (kind === 'w') return 'water'
  if (kind === 'm') return 'mountain'
  return kind
}

function normalizeCoordinate(value, precision = 5) {
  return typeof value === 'number' ? Number(value.toFixed(precision)) : value
}

function normalizeCollectionItem(fileName, item) {
  if (fileName === 'places.se.json' && Array.isArray(item)) {
    const [name, lat, lon, kind, importance] = item
    return {
      name,
      lat: normalizeCoordinate(lat, 2),
      lon: normalizeCoordinate(lon, 2),
      kind: normalizePlaceKind(kind),
      importance,
    }
  }

  if (fileName === 'places.se.json') {
    return {
      name: item.name,
      lat: normalizeCoordinate(item.lat, 2),
      lon: normalizeCoordinate(item.lon, 2),
      kind: normalizePlaceKind(item.kind),
      importance: item.importance,
    }
  }

  if (fileName === 'airports.se.json') {
    return {
      icao: item.icao,
      name: item.name,
      lat: normalizeCoordinate(item.arp?.lat ?? item.lat),
      lon: normalizeCoordinate(item.arp?.lon ?? item.lon),
      category: item.category,
      detailsInAd2: item.detailsInAd2,
    }
  }

  return item
}

function getCollection(fileName, payload) {
  const collection = Array.isArray(payload)
    ? payload
    : payload?.airports ??
      payload?.airspaces ??
      payload?.places ??
      payload?.navaids ??
      payload?.airportFrequencies ??
      payload?.airspaceFrequencies ??
      payload?.accSectors ??
      []

  return collection.map((item) => normalizeCollectionItem(fileName, item))
}

function countPayload(fileName, payload) {
  const collection = getCollection(fileName, payload)
  if (collection.length > 0) {
    return collection.length
  }

  return payload?.count ??
    null
}

function itemKey(fileName, item) {
  if (fileName === 'places.se.json') {
    return `${item?.name ?? ''}:${item?.kind ?? ''}`
  }

  return item?.id ??
    item?.icao ??
    `${item?.positionIndicator ?? ''}:${item?.kind ?? ''}:${item?.name ?? item?.unit ?? item?.sectorName ?? ''}`
}

function itemLabel(item) {
  if (item?.icao || item?.name) {
    return [item.icao, item.name, item.kind].filter(Boolean).join(' ')
  }

  if (item?.sectorName) {
    return [item.sectorCode, item.sectorName].filter(Boolean).join(' ')
  }

  if (item?.unit || item?.callSign) {
    return [item.positionIndicator, item.unit ?? item.callSign, item.frequencies?.join(', ')].filter(Boolean).join(' ')
  }

  return String(itemKey(item))
}

function summarizeCollection(fileName, previousPayload, nextPayload) {
  const previous = new Map(getCollection(fileName, previousPayload).map((item) => [itemKey(fileName, item), item]))
  const next = new Map(getCollection(fileName, nextPayload).map((item) => [itemKey(fileName, item), item]))
  const added = []
  const removed = []
  const changed = []

  for (const [key, item] of next) {
    if (!previous.has(key)) {
      added.push(`- added ${itemLabel(item)}`)
    } else if (stableStringify(previous.get(key)) !== stableStringify(item)) {
      changed.push(`- changed ${itemLabel(item)}`)
    }
  }

  for (const [key, item] of previous) {
    if (!next.has(key)) {
      removed.push(`- removed ${itemLabel(item)}`)
    }
  }

  return [...added, ...removed, ...changed].slice(0, 12)
}

function buildReport(changedFiles, previousPayloads, nextPayloads) {
  const lines = ['# Swedish aviation data update', '']

  if (changedFiles.length === 0) {
    lines.push('No public aviation data files changed.')
    return `${lines.join('\n')}\n`
  }

  lines.push('## Changed datasets', '')
  for (const fileName of changedFiles) {
    const previousPayload = previousPayloads.get(fileName)
    const nextPayload = nextPayloads.get(fileName)
    lines.push(`- \`${fileName}\`: ${countPayload(fileName, previousPayload) ?? 'n/a'} -> ${countPayload(fileName, nextPayload) ?? 'n/a'}`)
  }

  lines.push('', '## Notable changes', '')
  for (const fileName of changedFiles) {
    const details = summarizeCollection(
      fileName,
      previousPayloads.get(fileName),
      nextPayloads.get(fileName),
    )

    if (details.length > 0) {
      lines.push(`### ${fileName}`, '', ...details, '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function markdownToHtml(markdown) {
  return markdown
    .split('\n')
    .map((line) => {
      const escaped = line
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')

      if (escaped.startsWith('# ')) {
        return `<h1>${escaped.slice(2)}</h1>`
      }
      if (escaped.startsWith('## ')) {
        return `<h2>${escaped.slice(3)}</h2>`
      }
      if (escaped.startsWith('### ')) {
        return `<h3>${escaped.slice(4)}</h3>`
      }
      if (escaped.startsWith('- ')) {
        return `<p>${escaped}</p>`
      }
      return escaped ? `<p>${escaped}</p>` : ''
    })
    .join('\n')
}

async function uploadJsonFiles(supabase, bucket, prefix, sourceDir) {
  for (const fileName of dataFiles) {
    const filePath = resolve(sourceDir, fileName)
    const { error } = await supabase.storage
      .from(bucket)
      .upload(`${prefix}/${fileName}`, readFileSync(filePath), {
        cacheControl: '60',
        contentType: 'application/json',
        upsert: true,
      })

    if (error) {
      throw new Error(`Failed to upload ${fileName}: ${error.message}`)
    }
  }
}

async function readStorageJson(supabase, bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) {
    return null
  }

  return JSON.parse(await data.text())
}

async function readCurrentPayloads(supabase, bucket) {
  const payloads = new Map()

  for (const fileName of dataFiles) {
    const storagePayload = await readStorageJson(supabase, bucket, `current/${fileName}`)
    payloads.set(fileName, storagePayload ?? readJson(`public/vfrplan-data/${fileName}`))
  }

  return payloads
}

function readCandidatePayloads() {
  return new Map(dataFiles.map((fileName) => [
    fileName,
    readJson(`data/aviation/se/normalized/${fileName}`),
  ]))
}

async function sendEmail({ apiKey, fromEmail, toEmail, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      html,
    }),
  })

  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}: ${await response.text()}`)
  }
}

async function sendEmailViaFunction({ functionUrl, serviceRoleKey, fromEmail, toEmail, subject, html }) {
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: toEmail,
      subject,
      html,
    }),
  })

  if (!response.ok) {
    throw new Error(`Email function returned ${response.status}: ${await response.text()}`)
  }
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

const args = parseArgs()
const supabaseUrl = requireEnv('SUPABASE_URL')
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const bucket = optionalEnv('AVIATION_DATA_BUCKET', 'aviation-data')
const publicAppUrl = optionalEnv('AVIATION_PUBLIC_APP_URL', optionalEnv('VITE_PUBLIC_APP_URL', ''))
const supabase = createClient(supabaseUrl, serviceRoleKey)

if (args.has('--publish-current')) {
  await uploadJsonFiles(supabase, bucket, 'current', 'public/vfrplan-data')
  console.log(`Published current public aviation data to Supabase Storage bucket ${bucket}.`)
  process.exit(0)
}

const outputSnapshot = args.has('--keep-generated-output')
  ? null
  : snapshot([...normalizedFiles, ...generatedFiles])

try {
  run('npm', ['run', 'aviation:se:refresh'])
  run('npm', ['run', 'aviation:se:validate'])

  const currentPayloads = await readCurrentPayloads(supabase, bucket)
  const candidatePayloads = readCandidatePayloads()
  const changedFiles = dataFiles.filter((fileName) => {
    const previousPayload = currentPayloads.get(fileName)
    const nextPayload = candidatePayloads.get(fileName)
    return stableStringify(getCollection(fileName, previousPayload)) !== stableStringify(getCollection(fileName, nextPayload))
  })

  if (changedFiles.length === 0) {
    console.log('No public aviation data files changed. Nothing to submit.')
  } else {
    const updateId = randomUUID()
    const candidatePrefix = `candidates/${updateId}`
    const previewDataBaseUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${candidatePrefix}`
    const currentDataBaseUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/current`
    const previewParams = new URLSearchParams({
      aviationDataBaseUrl: previewDataBaseUrl,
      aviationDataCurrentBaseUrl: currentDataBaseUrl,
    })
    const previewUrl = publicAppUrl
      ? `${publicAppUrl.replace(/\/$/, '')}/app/aviation-data-preview?${previewParams.toString()}`
      : previewDataBaseUrl
    const approveToken = makeToken()
    const rejectToken = makeToken()
    const approvalFunctionUrl = optionalEnv(
      'AVIATION_APPROVAL_FUNCTION_URL',
      `${supabaseUrl}/functions/v1/aviation-data-approval`,
    )
    const approveUrl = `${approvalFunctionUrl}?action=approve&id=${updateId}&token=${approveToken}`
    const rejectUrl = `${approvalFunctionUrl}?action=reject&id=${updateId}&token=${rejectToken}`
    const reportMarkdown = buildReport(changedFiles, currentPayloads, candidatePayloads)

    await uploadJsonFiles(supabase, bucket, candidatePrefix, 'data/aviation/se/normalized')

    const { error: insertError } = await supabase.from('aviation_data_updates').insert({
      id: updateId,
      status: 'pending',
      storage_bucket: bucket,
      candidate_prefix: candidatePrefix,
      current_prefix: 'current',
      files: dataFiles,
      changed_files: changedFiles,
      report_markdown: reportMarkdown,
      preview_url: previewUrl,
      approve_token_hash: sha256(approveToken),
      reject_token_hash: sha256(rejectToken),
      source: {
        runner: basename(process.argv[1]),
        changedFiles,
        generatedAt: new Date().toISOString(),
      },
    })

    if (insertError) {
      throw insertError
    }

    const fromEmail = optionalEnv('AVIATION_DATA_FROM_EMAIL', optionalEnv('APP_FROM_EMAIL', 'VFRplan <noreply@andreasmartensson.com>'))
    const approverEmail = requireEnv('AVIATION_DATA_APPROVER_EMAIL')
    const html = `
      <p>Ny statisk flygdata finns att granska.</p>
      <p><a href="${previewUrl}">Oppna kartpreview med markerade andringar</a></p>
      <p><a href="${approveUrl}">Godkann uppdateringen</a> eller <a href="${rejectUrl}">avvisa uppdateringen</a>.</p>
      ${markdownToHtml(reportMarkdown)}
    `.trim()

    try {
      const subject = `VFRplan aviation data update: ${changedFiles.join(', ')}`
      const resendApiKey = process.env.RESEND_API_KEY?.trim()
      if (resendApiKey) {
        await sendEmail({
          apiKey: resendApiKey,
          fromEmail,
          toEmail: approverEmail,
          subject,
          html,
        })
      } else {
        await sendEmailViaFunction({
          functionUrl: optionalEnv('APP_EMAIL_FUNCTION_URL', `${supabaseUrl}/functions/v1/send-email`),
          serviceRoleKey,
          fromEmail,
          toEmail: approverEmail,
          subject,
          html,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await supabase
        .from('aviation_data_updates')
        .update({ status: 'failed', error_message: message })
        .eq('id', updateId)
      throw error
    }

    console.log(`Submitted aviation data update ${updateId}.`)
    console.log(`Preview: ${previewUrl}`)
  }
} finally {
  if (outputSnapshot) {
    restore(outputSnapshot)
  }
}
