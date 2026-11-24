import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'RMS_'])
  // Shell variables win over .env files; defaults suit a normal local run.
  const backend = process.env.RMS_BACKEND_URL || env.RMS_BACKEND_URL || 'http://localhost:8080'
  const port = Number(process.env.RMS_FRONTEND_PORT || env.RMS_FRONTEND_PORT || 3000)
  const useMocks = mode === 'mock' || env.VITE_USE_MOCKS === 'true'

  return {
    plugins: [
      vue(),
      VitePWA({
        // Registered by hand in src/pwa.ts so it never competes with the MSW mock worker.
        injectRegister: false,
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'RMS - Santhula Hotel',
          short_name: 'RMS',
          description: 'Restaurant Management System for Santhula Hotel, Netolpitiya',
          theme_color: '#0f766e',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
          globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
          globIgnores: ['mockServiceWorker.js'],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    define: {
      __RMS_USE_MOCKS__: JSON.stringify(useMocks),
    },
    server: {
      port,
      strictPort: true,
      proxy: useMocks
        ? undefined
        : {
            '/api': { target: backend, changeOrigin: true },
            '/ws': { target: backend, changeOrigin: true, ws: true },
          },
    },
  }
})
