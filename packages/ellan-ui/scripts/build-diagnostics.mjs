import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, '../../.reference/ellanlauncher')
const require = createRequire(resolve(source, 'packages/nbt/package.json'))
const esbuild = await import(pathToFileURL(require.resolve('esbuild')).href)
const output = resolve(root, 'dist/node/original-diagnostics.cjs')
await mkdir(resolve(root, 'dist/node'), { recursive: true })
await esbuild.build({
  entryPoints: [resolve(root, 'scripts/diagnostics-entry.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: output,
})
console.log('Built maintained Ellan diagnosis, argv, and process watcher helpers:', output)
