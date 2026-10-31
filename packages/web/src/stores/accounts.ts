/**
 * Account page store: the Microsoft device-code flow and the local form state
 * for creating an offline account.
 *
 * The account list itself lives in `useAppStore` (app/data.ts); this store
 * only holds what is page-scoped, namely the in-flight device flow and the
 * selected account used by the launcher button elsewhere in the app.
 */
import { create } from 'zustand'
import type { Account, DeviceCodeFlow } from '@rhine/core'
import { api } from '@/api/client'
import type { DeviceFlowPhase } from '@/features/accounts/accounts.ts'

const SELECTION_KEY = 'rhine.currentAccount'

interface AccountState {
  /** Account chosen for launching; persisted so a reload keeps the identity. */
  currentId: string | null
  flow: DeviceCodeFlow | null
  phase: DeviceFlowPhase
  flowError: string | null
  /** Polling generation; bumping it cancels the running loop. */
  pollToken: number
  creating: boolean

  setCurrent: (id: string | null) => void
  /** Start the device-code flow and begin polling in the background. */
  beginMicrosoft: () => Promise<DeviceCodeFlow>
  cancelFlow: () => void
  clearFlow: () => void
  /** Called by the page when the poll loop succeeds. */
  completeMicrosoft: () => Promise<Account>
}

function readStored(): string | null {
  try {
    return localStorage.getItem(SELECTION_KEY)
  } catch {
    return null
  }
}

function storeSelected(id: string | null): void {
  try {
    if (id) localStorage.setItem(SELECTION_KEY, id)
    else localStorage.removeItem(SELECTION_KEY)
  } catch {
    // Storage unavailable: selection is not persisted.
  }
}

export const useAccountStore = create<AccountState>((set, get) => ({
  currentId: readStored(),
  flow: null,
  phase: 'idle',
  flowError: null,
  pollToken: 0,
  creating: false,

  setCurrent: (id) => {
    storeSelected(id)
    set({ currentId: id })
  },

  beginMicrosoft: async () => {
    set({ phase: 'pending', flowError: null })
    try {
      const flow = await api.accounts.beginMicrosoft()
      set({ flow, phase: 'pending', pollToken: get().pollToken + 1 })
      return flow
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法启动微软登录'
      set({ phase: 'error', flowError: message, flow: null })
      throw error
    }
  },

  cancelFlow: () => {
    set((state) => ({ pollToken: state.pollToken + 1, phase: 'idle', flow: null, flowError: null }))
  },

  clearFlow: () => set({ flow: null, phase: 'idle', flowError: null }),

  completeMicrosoft: async () => {
    const account = await api.accounts.completeMicrosoft()
    set({ phase: 'authorized', flow: null, flowError: null })
    get().setCurrent(account.id)
    return account
  },
}))

/** Read the selected account id without subscribing. */
export function currentAccountId(): string | null {
  return useAccountStore.getState().currentId
}
