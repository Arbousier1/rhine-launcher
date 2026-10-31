import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@rhine/core': r('./packages/core/src/index.ts'),
      '@rhine/server': r('./packages/server/src/index.ts'),
      '@': r('./packages/web/src'),
    },
  },
  test: {
    // Fork workers (not threads): child_process stdio pipes deliver data reliably
    // only from a real process, which the launcher tests depend on.
    pool: 'forks',
    include: ['packages/**/test/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
})
