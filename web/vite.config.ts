import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地后端（worker/ 里 `npx wrangler dev`）默认跑在 8787
const API_TARGET = process.env.KOALA_API_TARGET ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  build: { outDir: 'dist', assetsInlineLimit: 4096 },
})
