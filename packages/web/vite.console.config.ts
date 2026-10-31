import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The archive console is built on its own so the React shell's entry chunk can
 * never be pulled into (or executed alongside) it.
 *
 * Upstream's build defines __RHINE_MODELS__ (content-hashed glb URLs); the
 * vendored code expects it, so the same define is reproduced here rather than
 * editing the scene.
 */
const models = ['archive-cassette', 'archive-assembly'].map((name) => {
  const source = readFileSync(r('./public/assets/' + name + '.glb'))
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
  return { key: 'assets/' + name + '.glb', fileName: 'assets/' + name + '.' + hash + '.glb', source }
})

export default defineConfig({
  base: '/',
  resolve: { alias: { '@': r('./src') } },
  define: {
    __RHINE_MODELS__: JSON.stringify(Object.fromEntries(models.map((m) => [m.key, m.fileName]))),
    __RHINE_NOVECENTO__: 'false',
  },
  plugins: [
    {
      name: 'versioned-model-assets',
      apply: 'build',
      buildStart() {
        for (const model of models) this.emitFile({ type: 'asset', fileName: model.fileName, source: model.source })
      },
    },
  ],
  server: {
    port: 5183,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6550', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:6550', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { input: { console: r('./console.html') } },
  },
})
