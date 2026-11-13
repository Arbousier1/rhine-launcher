import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'

const repository = fileURLToPath(new URL('../', import.meta.url))
await access(resolve(repository, 'packages/web/dist/app.html')).catch(() => {
  throw new Error('前端尚未构建，请先执行 pnpm build')
})
const require = createRequire(import.meta.url)
const electron = require('electron')
const env = { ...process.env }
// Clear the harness's Node-only mode for our GUI, not for other processes.
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [resolve(repository, 'packages/desktop'), ...process.argv.slice(2)], {
  cwd: repository, stdio: 'inherit', env,
})
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
