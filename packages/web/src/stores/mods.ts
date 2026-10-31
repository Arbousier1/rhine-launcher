/**
 * Mods page store: the fetched mod list, the toolbar filter and the pending
 * action set used to disable buttons while a toggle/delete round trip runs.
 *
 * Instances come from `useAppStore`; this store is keyed by instance id so
 * switching archives does not show a stale list.
 */
import { create } from 'zustand'
import type { ModFile } from '@rhine/core'
import { api } from '@/api/client'
import {
  DEFAULT_MOD_FILTER, filterMods, partitionByHealth, sortMods, summarize, withEnabled,
  type ModFilter, type ModSort,
} from '@/features/mods/mods.ts'

interface ModState {
  /** Instance the cached list belongs to. */
  instanceId: string | null
  mods: ModFile[]
  loading: boolean
  error: string | null
  /** Disk names with an in-flight action. */
  pending: Record<string, boolean>
  filter: ModFilter
  sort: ModSort
  /** Disk name selected in the detail column. */
  selected: string | null

  load: (instanceId: string, force?: boolean) => Promise<void>
  setFilter: (patch: Partial<ModFilter>) => void
  resetFilter: () => void
  setSort: (sort: ModSort) => void
  select: (diskName: string | null) => void
  toggle: (instanceId: string, mod: ModFile) => Promise<void>
  remove: (instanceId: string, diskName: string) => Promise<void>
  install: (instanceId: string, url: string, fileName: string) => Promise<string>
}

export const useModStore = create<ModState>((set, get) => ({
  instanceId: null,
  mods: [],
  loading: false,
  error: null,
  pending: {},
  filter: { ...DEFAULT_MOD_FILTER },
  sort: 'name',
  selected: null,

  load: async (instanceId, force = false) => {
    const state = get()
    if (!force && state.instanceId === instanceId && state.mods.length > 0 && !state.error) return
    set({ loading: true, error: null, instanceId })
    try {
      const mods = await api.instances.mods(instanceId)
      set({ mods, loading: false, selected: null })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '无法读取模组列表' })
    }
  },

  setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch }, selected: null })),

  resetFilter: () => set({ filter: { ...DEFAULT_MOD_FILTER } }),

  setSort: (sort) => set({ sort }),

  select: (selected) => set({ selected }),

  toggle: async (instanceId, mod) => {
    const next = !mod.enabled
    // Optimistic flip first: the switch must feel instant even on a slow disk.
    set((state) => ({
      mods: state.mods.map((item) => (item.diskName === mod.diskName ? withEnabled(item, next) : item)),
      pending: { ...state.pending, [mod.diskName]: true },
    }))
    try {
      const updated = await api.instances.toggleMod(instanceId, mod.diskName, next)
      set((state) => ({
        mods: state.mods.map((item) => (item.diskName === mod.diskName || item.diskName === updated.diskName ? updated : item)),
        pending: { ...state.pending, [mod.diskName]: false },
        selected: state.selected === mod.diskName ? updated.diskName : state.selected,
      }))
    } catch (error) {
      // Roll back so the UI never lies about the on-disk state.
      set((state) => ({
        mods: state.mods.map((item) => (item.diskName === mod.diskName ? mod : item)),
        pending: { ...state.pending, [mod.diskName]: false },
        error: error instanceof Error ? error.message : '切换失败',
      }))
      throw error
    }
  },

  remove: async (instanceId, diskName) => {
    set((state) => ({ pending: { ...state.pending, [diskName]: true } }))
    try {
      await api.instances.deleteMod(instanceId, diskName)
      set((state) => ({
        mods: state.mods.filter((item) => item.diskName !== diskName),
        pending: { ...state.pending, [diskName]: false },
        selected: state.selected === diskName ? null : state.selected,
      }))
    } catch (error) {
      set((state) => ({
        pending: { ...state.pending, [diskName]: false },
        error: error instanceof Error ? error.message : '删除失败',
      }))
      throw error
    }
  },

  install: async (instanceId, url, fileName) => {
    const { taskId } = await api.instances.installMod(instanceId, url, fileName)
    return taskId
  },
}))

/** Derived: the list after filtering and sorting. */
export function visibleMods(state: ModState): ModFile[] {
  return sortMods(filterMods(state.mods, state.filter), state.sort)
}

/** Derived: readable rows plus the jars that could not be parsed. */
export function modBuckets(state: ModState): { readable: ModFile[]; broken: ModFile[] } {
  return partitionByHealth(visibleMods(state))
}

/** Derived: header counters for the whole list (not the filtered one). */
export function modStats(state: ModState) {
  return summarize(state.mods)
}
