import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repository = resolve(packageRoot, '../..')
const original = resolve(packageRoot, 'dist/original')
const compat = resolve(packageRoot, 'dist/compat')
const renderer = resolve(packageRoot, 'dist/renderer')
const marker = '<!-- Rhine virtual transport, then unchanged DeskGap bridge. -->'

/** @param {string} html */
export function prependBridgeScripts(html) {
  if (!/<head(?:\s[^>]*)?>/i.test(html) || !/<script\b[^>]*\btype\s*=\s*['"]module['"]/i.test(html)) {
    throw new Error('Original renderer HTML must contain a head and renderer module')
  }
  if (html.includes(marker)) throw new Error('Assemble from dist/original, not an already adapted renderer')
  const scripts = '\n    ' + marker
    + '\n    <script src="./compat/virtual-deskgap.js"></script>'
    + '\n    <script src="./compat/deskgap-browser.js"></script>'
  // Blocking classic scripts install window.deskgap and then the original API
  // before any original module runs. Never rewrite http://launcher URLs: some
  // upstream code passes them directly to new URL(), which rejects relatives.
  return html.replace(/<head(?:\s[^>]*)?>/i, head => head + scripts)
}

/** Compile/check without writes, or assemble the separate non-default renderer. */
export async function assembleRenderer({ check = false } = {}) {
  const html = prependBridgeScripts(await readFile(resolve(original, 'index.html'), 'utf8'))
  await readFile(resolve(compat, 'deskgap-browser.js')) // Fail before replacing output if the original bridge is absent.
  const upstream = resolve(repository, '.reference/ellanlauncher')
  // Keep dependency/compiler policy unchanged, exactly as build-bridge.mjs does.
  const require = createRequire(resolve(upstream, 'packages/nbt/package.json'))
  const esbuild = await import(pathToFileURL(require.resolve('esbuild')).href)
  const built = await esbuild.build({
    absWorkingDir: repository,
    entryPoints: [resolve(packageRoot, 'src/entry.ts')], bundle: true,
    platform: 'browser', format: 'iife', target: 'es2022', sourcemap: true,
    legalComments: 'external', outfile: resolve(renderer, 'compat/virtual-deskgap.js'), write: false,
    plugins: [{name:'ui-inline-css',setup(build){
      build.onResolve({filter:/[.]css[?]inline$/},args=>({path:resolve(args.resolveDir,args.path.replace(/[?]inline$/,'')),namespace:'ui-css'}))
      build.onLoad({filter:/.*/,namespace:'ui-css'},async args=>({contents:'export default '+JSON.stringify(await readFile(args.path,'utf8')),loader:'js'}))
    }}],
  })
  if (check) return { renderer, check: true, shimFiles: built.outputFiles.length }

  // The only deletion target is this fixed, resolved build-output directory.
  if (dirname(renderer) !== resolve(packageRoot, 'dist') || relative(packageRoot, renderer) !== ['dist', 'renderer'].join(sep)) {
    throw new Error('Refusing to replace an unexpected renderer output path')
  }
  console.log('Assembling separate renderer at ' + renderer)
  await rm(renderer, { recursive: true, force: true })
  await cp(original, renderer, { recursive: true })
  await cp(compat, resolve(renderer, 'compat'), { recursive: true })
  for (const file of built.outputFiles) {
    const within = relative(renderer, file.path)
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) {
      throw new Error('Shim output escaped the renderer directory')
    }
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.contents)
  }
  await writeFile(resolve(renderer, 'index.html'), html)
  return { renderer, check: false, shimFiles: built.outputFiles.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await assembleRenderer({ check: process.argv.includes('--check') })
  console.log(result.check
    ? 'Ellan assembly check passed: shim compiled and blocking script order verified; no files written.'
    : 'Original Ellan renderer copied unchanged except for the ordered transport/bridge scripts; not activated.')
}
