import { spawnSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repository = resolve(packageRoot, '../..')
const upstream = resolve(repository, '.reference/ellanlauncher')
const ui = resolve(upstream, 'xmcl-keystone-ui')
const metadata = JSON.parse(await readFile(resolve(packageRoot, 'upstream.json'), 'utf8'))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim()
if (revision !== metadata.revision) throw new Error('Original Ellan source revision does not match upstream.json')
// This package never recreates or patches the original Vue views/components.
const unchanged = spawnSync('git', ['diff', '--quiet', '--', 'xmcl-keystone-ui/src/views', 'xmcl-keystone-ui/src/components', 'xmcl-keystone-ui/locales'], { cwd: upstream, stdio: 'inherit' })
if (unchanged.status !== 0) throw new Error('Original views/components/locales contain unreviewed modifications')
const requireUi = createRequire(resolve(ui, 'package.json'))
const requireNbt = createRequire(resolve(upstream, 'packages/nbt/package.json'))
const esbuild = await import(pathToFileURL(requireNbt.resolve('esbuild')).href)
const nbtOutput = resolve(upstream, 'packages/nbt/dist/index.browser.mjs')
try { await access(nbtOutput) } catch {
  await esbuild.build({ entryPoints: [resolve(upstream, 'packages/nbt/index.ts')],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2020', sourcemap: true,
    external: ['@xmcl/*', 'pako'], outfile: nbtOutput })
}
const vite = resolve(dirname(requireUi.resolve('vite/package.json')), 'bin/vite.js')
const output = resolve(packageRoot, 'dist/original')
const built = spawnSync(process.execPath, [vite, 'build', '--config', resolve(ui, 'vite.config.ts'), '--outDir', output], { cwd: ui, stdio: 'inherit' })
if (built.status !== 0) process.exit(built.status ?? 1)
await buildBridge(esbuild)
for (const script of ['extract-defaults.mjs', 'build-game-data.mjs', 'build-diagnostics.mjs']) {
  const result = spawnSync(process.execPath, [resolve(packageRoot, 'scripts', script)], { cwd: repository, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
await mkdir(resolve(packageRoot, 'dist'), { recursive: true })
await copyFile(resolve(packageRoot, 'LICENSE.upstream'), resolve(packageRoot, 'dist/LICENSE.upstream'))
await writeFile(resolve(packageRoot, 'dist/build-source.json'), JSON.stringify({
  revision, originalRenderer: 'dist/original/index.html', originalBridge: 'dist/compat/deskgap-browser.js',
  viewsModified: false, componentsModified: false, localesModified: false,
  runtimeAdapterRequired: true,
}, null, 2) + '\n')

async function buildBridge(builder) {
  // DeskGap itself is not launched. Its original browser bridge can run over
  // the tiny createChannel/onFilesDropped provider supplied by the Rhine adapter.
  await builder.build({
    entryPoints: [resolve(upstream, 'deskgap-app/src/browser.ts')], bundle: true,
    platform: 'browser', format: 'iife', target: 'es2022', sourcemap: true,
    alias: { '@xmcl/runtime-api': resolve(upstream, 'xmcl-runtime-api/index.ts') },
    outfile: resolve(packageRoot, 'dist/compat/deskgap-browser.js'), legalComments: 'external',
  })
}
