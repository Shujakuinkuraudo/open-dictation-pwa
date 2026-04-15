import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function resolveBase(): string {
  const explicit = process.env.PAGES_BASE_PATH
  if (explicit) {
    return explicit.endsWith('/') ? explicit : `${explicit}/`
  }

  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (process.env.GITHUB_ACTIONS === 'true' && repo && !repo.endsWith('.github.io')) {
    return `/${repo}/`
  }

  return '/'
}

const base = resolveBase()

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Dictation Prototype',
        short_name: 'Dictation',
        description: 'Voice dictation, transcription, and LLM post-processing web app.',
        theme_color: '#2563eb',
        background_color: '#f8fafd',
        display: 'standalone',
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['asr.shujk.top'],
  },
})
