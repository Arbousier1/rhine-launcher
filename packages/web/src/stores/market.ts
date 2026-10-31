/**
 * Market store: source switch, search query, result pages, the open project's
 * version list and the install queue shown in the drawer.
 *
 * Network calls live here so the page component stays a pure render function;
 * failures keep the previous result set visible with an inline error, which
 * matches how HMCL degrades when the network drops.
 */
import { create } from 'zustand'
import type {
  MarketProject, MarketSearchResult, MarketVersion, MarketSource,
} from '@rhine/core'
import { api } from '@/api/client'
import {
  DEFAULT_MARKET_QUERY, sortVersions, toSearchInput, type MarketQuery, type MarketSort,
} from '@/features/market/market.ts'

/** Install lifecycle for one market version. */
export type InstallPhase = 'idle' | 'installing' | 'done' | 'error'

interface MarketState {
  query: MarketQuery
  result: MarketSearchResult | null
  loading: boolean
  /** True while a page of results is being appended/replaced. */
  error: string | null

  /** Project opened in the detail drawer. */
  activeProject: MarketProject | null
  versions: MarketVersion[]
  versionsLoading: boolean
  versionsError: string | null

  /** Install state per version id. */
  installing: Record<string, InstallPhase>
  installedVersionIds: string[]

  setSource: (source: MarketSource) => void
  patchQuery: (patch: Partial<MarketQuery>) => void
  setPage: (page: number) => void
  setSort: (sort: MarketSort) => void
  search: (overrides?: Partial<MarketQuery>) => Promise<void>
  openProject: (project: MarketProject) => Promise<void>
  closeProject: () => void
  install: (instanceId: string, version: MarketVersion) => Promise<string>
}

export const useMarketStore = create<MarketState>((set, get) => ({
  query: { ...DEFAULT_MARKET_QUERY },
  result: null,
  loading: false,
  error: null,
  activeProject: null,
  versions: [],
  versionsLoading: false,
  versionsError: null,
  installing: {},
  installedVersionIds: [],

  setSource: (source) => {
    if (get().query.source === source) return
    set((state) => ({
      query: { ...state.query, source, page: 0 },
      result: null,
      error: null,
      activeProject: null,
      versions: [],
    }))
  },

  patchQuery: (patch) => set((state) => ({
    query: { ...state.query, ...patch, page: patch.page ?? 0 },
  })),

  setPage: (page) => set((state) => ({ query: { ...state.query, page } })),

  setSort: (sort) => set((state) => ({ query: { ...state.query, sort, page: 0 } })),

  search: async (overrides) => {
    const query: MarketQuery = { ...get().query, ...overrides }
    set({ query, loading: true, error: null })
    try {
      const result = await api.market.search(toSearchInput(query))
      set({ result, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '搜索失败，请稍后重试',
        // Keep the previous page visible instead of blanking the grid.
      })
    }
  },

  openProject: async (project) => {
    const { query } = get()
    set({
      activeProject: project,
      versions: [],
      versionsLoading: true,
      versionsError: null,
    })
    try {
      const versions = await api.market.versions(project.source, project.id, {
        gameVersion: query.gameVersion || undefined,
        loader: query.loader || undefined,
      })
      // Never drop everything: if the filter is too narrow, fall back to all
      // versions and let the drawer badge tell the user.
      const list = versions.length
        ? versions
        : await api.market.versions(project.source, project.id)
      set({ versions: sortVersions(list), versionsLoading: false })
    } catch (error) {
      set({
        versionsLoading: false,
        versionsError: error instanceof Error ? error.message : '无法获取版本列表',
      })
    }
  },

  closeProject: () => set({ activeProject: null, versions: [], versionsError: null }),

  install: async (instanceId, version) => {
    set((state) => ({ installing: { ...state.installing, [version.id]: 'installing' } }))
    try {
      const { taskId } = await api.market.install(instanceId, version)
      set((state) => ({
        installing: { ...state.installing, [version.id]: 'done' },
        installedVersionIds: [...state.installedVersionIds, version.id],
      }))
      return taskId
    } catch (error) {
      set((state) => ({ installing: { ...state.installing, [version.id]: 'error' } }))
      throw error
    }
  },
}))
