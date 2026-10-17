import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5178,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://127.0.0.1:3078', changeOrigin: false } },
  },
  build: { target: 'safari16', chunkSizeWarningLimit: 900 },
})
