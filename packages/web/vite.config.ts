import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@rhine/core': r('../core/src/index.ts'),
      '@': r('./src'),
    },
  },
  server: {
    port: 5183,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6550', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:6550', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        // The RhineLab console is the product UI; the React shell is kept
        // available at /app.html for the settings/plugins screens.
        app: r('./app.html'),
      },
    },
  },
})
