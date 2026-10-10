import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages ではリポジトリ名のサブパスで配信されるため、BASE_PATH で切り替える
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // オフラインで確実に動くよう1ファイルにまとめているので、警告の閾値を上げる
  build: { chunkSizeWarningLimit: 800 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ラテリエ',
        short_name: 'ラテリエ',
        description: 'ラテアートの練習を1杯ずつ撮って残すアプリ',
        lang: 'ja',
        theme_color: '#faf7f2',
        background_color: '#faf7f2',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          // 写真の絵柄が端まであるので、マスク用にも同じ画像を使う
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico,webp,webmanifest}'],
        // フォントは Google Fonts から読み、一度読んだらオフラインでも使えるよう保存する
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
})
