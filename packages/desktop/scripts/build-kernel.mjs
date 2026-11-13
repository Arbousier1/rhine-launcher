import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const repository = resolve(root, '../..')
const require = createRequire(resolve(repository, '.reference/ellanlauncher/packages/nbt/package.json'))
const esbuild = await import(pathToFileURL(require.resolve('esbuild')).href)
await esbuild.build({ entryPoints: [resolve(repository, 'packages/plugin-api/src/index.ts')], bundle: true,
  platform: 'node', format: 'cjs', target: 'node22', outfile: resolve(root, 'dist/feature-runtime.cjs') })
