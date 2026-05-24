import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

type RecentCommit = {
  hash: string
  date: string
  subject: string
}

function resolveAppVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

function resolveRecentCommits(): RecentCommit[] {
  try {
    const output = execSync('git log -5 --date=short --pretty=format:%h%x09%ad%x09%s', { encoding: 'utf8' }).trim()

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
})
