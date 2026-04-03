import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['knobbier-superingeniously-delbert.ngrok-free.dev'],
    proxy: {
      // During local dev, /api/* is forwarded to the local FastAPI server.
      // In Vercel prod, the serverless function api/[...path].js handles this.
      '/api': {
        target: 'http://13.232.27.217:8080',
        rewrite: (path) => path.replace(/^\/api/, ''),
        changeOrigin: true,
      },
    },
  },
})
