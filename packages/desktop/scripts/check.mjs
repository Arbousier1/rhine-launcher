import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
for (const name of ['main.cjs', 'backend.cjs', 'preload.cjs', 'web-transport.cjs']) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, 'src', name)], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
