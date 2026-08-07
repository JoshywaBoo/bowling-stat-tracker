import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const prodEnv = loadEnv('production', process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      watch: {
        usePolling: true,
      },
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || prodEnv.VITE_API_TARGET,
          changeOrigin: true,
        },
      },
    },
  }
})