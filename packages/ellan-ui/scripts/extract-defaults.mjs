import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, '../../.reference/ellanlauncher')
const require = createRequire(resolve(source, 'packages/nbt/package.json'))
const esbuild = await import(pathToFileURL(require.resolve('esbuild')).href)
await mkdir(resolve(root, 'dist/node'), { recursive: true })
const out = resolve(root, 'dist/node/original-defaults.cjs')
await esbuild.build({ entryPoints: [resolve(root, 'scripts/defaults-entry.ts')], bundle: true,
  platform: 'node', format: 'cjs', target: 'node22', outfile: out })
const { defaults } = require(out)
const path = resolve(root, 'data/original-defaults.json')
await mkdir(resolve(root, 'data'), { recursive: true })
await writeFile(path, JSON.stringify(defaults, null, 2) + '\n')
console.log('Original default state fields extracted:', Object.keys(defaults).join(', '))
