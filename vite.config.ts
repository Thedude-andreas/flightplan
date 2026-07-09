import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

type RecentCommit = {
  hash: string
  date: string
  subject: string
}

const recentUpdateWindowDays = 30
const minimumRecentCommits = 10
const gitCommitFormat = '--date=short --pretty=format:%h%x09%ad%x09%s'

function resolveAppVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

function readRecentCommits(command: string): RecentCommit[] {
  const output = execSync(command, { encoding: 'utf8' }).trim()

  if (!output) {
    return []
  }

  return output.split('\n').map((line) => {
    const [hash = '', date = '', ...subjectParts] = line.split('\t')

    return {
      hash,
      date,
      subject: subjectParts.join('\t'),
    }
  })
}

function mergeCommits(primary: RecentCommit[], fallback: RecentCommit[]) {
  const commitsByHash = new Map<string, RecentCommit>()

  for (const commit of [...primary, ...fallback]) {
    if (!commitsByHash.has(commit.hash)) {
      commitsByHash.set(commit.hash, commit)
    }
  }

  return Array.from(commitsByHash.values())
}

function resolveRecentCommits(): RecentCommit[] {
  try {
    const commitsInWindow = readRecentCommits(`git log --since="${recentUpdateWindowDays} days ago" ${gitCommitFormat}`)
    const latestCommits = readRecentCommits(`git log -${minimumRecentCommits} ${gitCommitFormat}`)

    return mergeCommits(commitsInWindow, latestCommits)
  } catch {
    return []
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/mapbox-gl')) {
            return 'mapbox'
          }

          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) {
            return 'leaflet'
          }
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    __RECENT_COMMITS__: JSON.stringify(resolveRecentCommits()),
  },
  plugins: [react()],
  server: {
    proxy: {
      '/lfv-wfs': {
        target: 'https://daim.lfv.se',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/lfv-wfs/, '/geoserver/wfs'),
      },
    },
  },
})
