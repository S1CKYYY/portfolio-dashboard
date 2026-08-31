import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const SNAPSHOT_PATH = resolve(import.meta.dirname, '../snapshot.json')
const SNAPSHOT_ROUTE = '/snapshot.json'

function snapshotPlugin(): Plugin {
  return {
    name: 'portfolio-snapshot',
    configureServer(server) {
      server.middlewares.use(SNAPSHOT_ROUTE, (_request, response) => {
        try {
          response.setHeader('Content-Type', 'application/json')
          response.end(readFileSync(SNAPSHOT_PATH, 'utf-8'))
        } catch {
          response.statusCode = 404
          response.end(JSON.stringify({ error: 'snapshot.json not found' }))
        }
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'snapshot.json',
        source: readFileSync(SNAPSHOT_PATH, 'utf-8'),
      })
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), react(), snapshotPlugin()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts')) return 'echarts'
          if (id.includes('node_modules/lightweight-charts')) return 'lightweight-charts'
          return undefined
        },
      },
    },
  },
})
