import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/** Default launcher UI only. The experimental 3D terminal is built separately. */
export default defineConfig({
  root: r('./'),
  base: '/',
  resolve: { alias: { '@rhine/core': r('../core/src/index.ts'), '@': r('./src') } },
  server: {
    port: 5183,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6550', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:6550', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: false, sourcemap: true, rollupOptions: { input: { main: r('./app.html') } } },
})
