import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages ではリポジトリ名のサブパスで配信されるため、BASE_PATH で切り替える
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: { config: true },
      manifest: {
        name: '道しるべ',
        short_name: '道しるべ',
        description: 'スキルのロードマップと練習記録をつなぐアプリ',
        lang: 'ja',
        theme_color: '#1f6f5c',
        background_color: '#f6f5f1',
        display: 'standalone',
        start_url: base,
        scope: base,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
})
