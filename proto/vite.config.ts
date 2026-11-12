import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 試作用。本番のビルド（ルートの vite.config.ts）には入らない。`pnpm exec vite --config proto/vite.config.ts` で起動する
export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [react()],
  server: { port: 5181, host: true, fs: { allow: ['..'] } },
})
