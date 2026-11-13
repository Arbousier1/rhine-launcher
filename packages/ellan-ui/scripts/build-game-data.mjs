import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const require=createRequire(resolve(root,'../../.reference/ellanlauncher/packages/nbt/package.json'))
const esbuild=await import(pathToFileURL(require.resolve('esbuild')).href)
await esbuild.build({entryPoints:[resolve(root,'scripts/game-data-entry.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(root,'dist/node/game-data.cjs')})
