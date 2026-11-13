import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const upstream = resolve(root, '../../.reference/ellanlauncher')
const require = createRequire(resolve(upstream, 'packages/nbt/package.json'))
const esbuild = await import(pathToFileURL(require.resolve('esbuild')).href)
await esbuild.build({ entryPoints: [resolve(upstream, 'deskgap-app/src/browser.ts')], bundle: true,
  platform: 'browser', format: 'iife', target: 'es2022', sourcemap: true, legalComments: 'external',
  alias: { '@xmcl/runtime-api': resolve(upstream, 'xmcl-runtime-api/index.ts') },
  outfile: resolve(root, 'dist/compat/deskgap-browser.js') })
console.log('Original DeskGap browser bridge compiled unchanged.')
