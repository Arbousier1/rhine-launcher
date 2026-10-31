/**
 * React bindings for the feature registry.
 *
 * The snapshot returned by `registry.snapshot()` is stable between mutations,
 * which is exactly what useSyncExternalStore needs; no copying happens in the
 * hook, so slot lists keep their identity and children do not re-render for
 * free.
 */
import { createContext, useContext, useSyncExternalStore } from 'react'
import { webPlugins } from './registry.ts'
import type { WebFeatureEntry, WebFeatureSnapshot } from './types.ts'
import type { WebFeatureRegistry } from './registry.ts'

/** Tests can swap in an isolated registry; production uses the singleton. */
export const WebPluginContext = createContext<WebFeatureRegistry>(webPlugins)

export function useWebRegistry(): WebFeatureRegistry {
  return useContext(WebPluginContext)
}

export function useWebPlugins(): WebFeatureSnapshot {
  const registry = useWebRegistry()
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getServerSnapshot)
}

const EMPTY_ENTRIES: readonly WebFeatureEntry[] = Object.freeze([])

export function useSlotFeatures(slot: string): readonly WebFeatureEntry[] {
  const snapshot = useWebPlugins()
  return snapshot.slots[slot] ?? EMPTY_ENTRIES
}

export function useFeatureEntry(id: string): WebFeatureEntry | undefined {
  const snapshot = useWebPlugins()
  return snapshot.byId[id]
}

export function useFeatureEnabled(id: string): boolean {
  const entry = useFeatureEntry(id)
  return entry?.status === 'enabled'
}
