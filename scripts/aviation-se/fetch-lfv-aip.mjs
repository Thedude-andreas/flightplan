import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { request } from 'node:https'

const sourceUrl = 'https://aro.lfv.se/Content/eaip/AIP_OFFLINE.zip'
const outputPath = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE.zip')
const metadataPath = resolve('data/aviation/se/raw/lfv/AIP_OFFLINE.metadata.json')

mkdirSync(dirname(outputPath), { recursive: true })

if (process.argv.includes('--skip-if-exists') && existsSync(outputPath)) {
  const { size } = statSync(outputPath)
  console.log(`AIP offline package already exists: ${outputPath} (${size} bytes)`)
  process.exit(0)
}

console.log(`Downloading LFV AIP offline package from ${sourceUrl}`)

const download = (url, destination) =>
  new Promise((resolvePromise, rejectPromise) => {
    const file = createWriteStream(destination)

    const req = request(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        file.close()
        download(response.headers.location, destination).then(resolvePromise).catch(rejectPromise)
        return
      }

      if (response.statusCode !== 200) {
        rejectPromise(new Error(`Unexpected response ${response.statusCode ?? 'unknown'}`))
        return
      }

      const totalBytes = Number(response.headers['content-length'] ?? 0)
      let downloadedBytes = 0

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length
        if (totalBytes > 0) {
          const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1)
          process.stdout.write(`\r${progress}% (${downloadedBytes}/${totalBytes} bytes)`)
        }
      })

      response.pipe(file)

      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n')
          writeFileSync(
            metadataPath,
            JSON.stringify(
              {
                sourceUrl: response.responseUrl ?? url,
                downloadedAt: new Date().toISOString(),
                contentLength: totalBytes,
                lastModified: response.headers['last-modified'] ?? null,
                etag: response.headers.etag ?? null,
              },
              null,
              2,
            ),
          )
          resolvePromise(undefined)
        })
      })
    })

    req.on('error', (error) => {
      file.close()
      rejectPromise(error)
    })

    req.end()
  })

download(sourceUrl, outputPath)
  .then(() => {
    const { size } = statSync(outputPath)
    console.log(`Saved LFV AIP offline package to ${outputPath} (${size} bytes)`)
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
