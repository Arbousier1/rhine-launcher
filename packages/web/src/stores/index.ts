/**
 * Store barrel.
 *
 * `useAppStore` (app/data.ts) is the single source of truth for bootstrap,
 * settings, instances, accounts, java runtimes, sessions and tasks — it is
 * owned by the app shell. The stores re-exported here only hold page-local
 * state (filters, drafts, log buffers) so there is never a second copy of the
 * global data.
 */
export {
  useAppStore, useSettings, activeSessions, formatBytes, subscribeNotices, currentNotices,
} from '@/app/data.ts'
export type { AppState, ConnectionState, LoadStatus, ServerNotice } from '@/app/data.ts'

export { useModStore, visibleMods, modBuckets, modStats } from './mods.ts'
export { useMarketStore } from './market.ts'
export {
  useLaunchStore, sessionLogs, attachLaunchLogStream, detachLaunchLogStream, runningSessions,
  LOG_BUFFER_LIMIT,
} from './launch.ts'
export { useAccountStore, currentAccountId } from './accounts.ts'
export { useJavaStore } from './java.ts'
export type { JavaDownloadPhase } from './java.ts'
export type { InstallPhase } from './market.ts'

import { useAppStore } from '@/app/data.ts'

/**
 * Ensure the global store has been hydrated.
 *
 * Idempotent by construction: `useAppStore.init()` memoises its promise, so
 * the shell and every page can call this without extra requests.
 */
export function initStores(): Promise<void> {
  return useAppStore.getState().init()
}