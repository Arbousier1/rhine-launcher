/**
 * Java page store: scan results and the download queue of managed runtimes.
 *
 * The bootstrap snapshot already carries the cached runtimes, which the page
 * seeds from `useAppStore`; this store owns the explicit scan and the
 * per-component download phase.
 */
import { create } from 'zustand'
import type { JavaRuntime } from '@rhine/core'
import { api } from '@/api/client'

/** Download lifecycle for one Mojang runtime component. */
export type JavaDownloadPhase = 'idle' | 'downloading' | 'done' | 'error'

interface JavaState {
  runtimes: JavaRuntime[]
  scanning: boolean
  error: string | null
  /** Phase per component name, e.g. `java-runtime-gamma`. */
  downloads: Record<string, JavaDownloadPhase>
  /** Task id per component so the logs page can follow the progress. */
  taskIds: Record<string, string>

  seed: (runtimes: JavaRuntime[]) => void
  scan: () => Promise<JavaRuntime[]>
  download: (component: string) => Promise<string>
}

export const useJavaStore = create<JavaState>((set, get) => ({
  runtimes: [],
  scanning: false,
  error: null,
  downloads: {},
  taskIds: {},

  seed: (runtimes) => {
    // Only seed when nothing has been scanned yet: a scan result is fresher.
    if (get().runtimes.length > 0) return
    set({ runtimes })
  },

  scan: async () => {
    set({ scanning: true, error: null })
    try {
      const runtimes = await api.java.scan()
      set({ runtimes, scanning: false })
      return runtimes
    } catch (error) {
      set({
        scanning: false,
        error: error instanceof Error ? error.message : '扫描 Java 运行时失败',
      })
      throw error
    }
  },

  download: async (component) => {
    set((state) => ({ downloads: { ...state.downloads, [component]: 'downloading' } }))
    try {
      const { taskId } = await api.java.install(component)
      set((state) => ({
        downloads: { ...state.downloads, [component]: 'done' },
        taskIds: { ...state.taskIds, [component]: taskId },
      }))
      return taskId
    } catch (error) {
      set((state) => ({ downloads: { ...state.downloads, [component]: 'error' } }))
      throw error
    }
  },
}))
