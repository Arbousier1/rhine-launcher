'use strict'
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

function sameDirectory(left, right) {
  const normalize = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  return typeof left === 'string' && normalize(left) === normalize(right)
}
async function probe(origin) {
  try {
    const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return undefined
    const value = await response.json()
    return value?.app?.name === 'Rhine Launcher' && typeof value?.paths?.root === 'string' ? value : undefined
  } catch { return undefined }
}

/** Borrow only a matching launcher; otherwise start and own exactly one child. */
async function ensureBackend(options) {
  const { repository, dataDirectory, port, executable, timeoutMs = 30000 } = options
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('后端端口必须为 0–65535')
  let origin = port === 0 ? undefined : 'http://127.0.0.1:' + port
  if (origin) {
    const existing = await probe(origin)
    if (existing) {
      if (!sameDirectory(existing.paths.root, dataDirectory)) throw new Error('端口上的启动器使用了其他数据目录，请指定其他端口')
      return { origin, owned: false, pid: existing.app.pid, stop: async () => {} }
    }
  }
  const loader = resolve(repository, 'node_modules/tsx/dist/loader.mjs')
  const entry = resolve(repository, 'packages/server/src/main.ts')
  if (!existsSync(loader) || !existsSync(entry)) throw new Error('启动器后端依赖不完整，请先安装工作区依赖')
  // Use the loader directly: no npm/shell wrapper or unowned grandchild.
  const child = spawn(executable, ['--import', pathToFileURL(loader).href, entry,
    '--port', String(port), '--data-dir', dataDirectory], {
    cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  let failure, exited = false, tail = ''
  const collect = bytes => {
    tail = (tail + bytes.toString()).slice(-8000)
    const ready = /Rhine Launcher: (http:\/\/127\.0\.0\.1:\d+)/.exec(tail)
    if (ready) origin = ready[1]
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', error => { failure = error })
  child.on('exit', (code, signal) => {
    exited = true
    failure ??= new Error('后端退出：' + (code ?? signal ?? 'unknown'))
  })
  let stopping
  const stop = () => stopping ??= (async () => {
    if (!child.pid || exited || child.exitCode !== null) return
    await new Promise(resolveStop => {
      const force = setTimeout(() => { child.kill('SIGKILL') }, 3000)
      child.once('exit', () => { clearTimeout(force); resolveStop() })
      child.kill('SIGTERM')
    })
  })()
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (failure) throw failure
      if (origin) {
        const value = await probe(origin)
        if (value && value.app.pid === child.pid && sameDirectory(value.paths.root, dataDirectory)) {
          return { origin, owned: true, pid: child.pid, stop }
        }
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
    throw new Error('启动器后端未在规定时间内就绪')
  } catch (error) {
    await stop()
    throw new Error((error instanceof Error ? error.message : String(error)) + (tail ? '\n' + tail : ''))
  }
}
module.exports = { ensureBackend, sameDirectory }
