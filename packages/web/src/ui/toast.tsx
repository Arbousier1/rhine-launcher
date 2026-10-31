/**
 * Toast notifications. The store is module level so non-React code (stores,
 * api error handlers) can push messages; `useToast()` is the React handle and
 * `ToastProvider` renders the stack inside the app shell.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type ToastLevel = 'info' | 'ok' | 'success' | 'warn' | 'error'

export interface ToastInput {
  level?: ToastLevel
  message: ReactNode
  caption?: ReactNode
  duration?: number
  id?: string
}

export interface ToastRecord {
  id: string
  level: ToastLevel
  message: ReactNode
  caption?: ReactNode
  duration: number
}

export interface ToastHandle {
  show: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const listeners = new Set<(records: ToastRecord[]) => void>()
let records: ToastRecord[] = []
let seed = 0
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function publish() {
  const snapshot = records.slice()
  for (const listener of listeners) listener(snapshot)
}

function normalize(level?: ToastLevel): ToastRecord['level'] {
  return level === 'success' ? 'ok' : level ?? 'info'
}

export const toast: ToastHandle & Record<'info' | 'ok' | 'success' | 'warn' | 'error', (message: ReactNode) => string> = {
  show(input) {
    const id = input.id ?? `toast-${++seed}`
    const duration = input.duration ?? (normalize(input.level) === 'error' ? 6500 : 3800)
    const record: ToastRecord = {
      id,
      level: normalize(input.level),
      message: input.message,
      caption: input.caption,
      duration,
    }
    records = [...records.filter((item) => item.id !== id), record]
    publish()
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => toast.dismiss(id), duration),
      )
    }
    return id
  },
  dismiss(id) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    records = records.filter((item) => item.id !== id)
    publish()
  },
  info(message) {
    return toast.show({ level: 'info', message })
  },
  ok(message) {
    return toast.show({ level: 'ok', message })
  },
  success(message) {
    return toast.show({ level: 'ok', message })
  },
  warn(message) {
    return toast.show({ level: 'warn', message })
  },
  error(message) {
    return toast.show({ level: 'error', message })
  },
}

export function useToast(): ToastHandle {
  return toast
}

/** Subscribe to the toast stack (used by the provider and by tests). */
export function useToastRecords(): ToastRecord[] {
  const [snapshot, setSnapshot] = useState<ToastRecord[]>(records)
  useEffect(() => {
    listeners.add(setSnapshot)
    setSnapshot(records.slice())
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])
  return snapshot
}

export function ToastProvider({ children }: { children?: ReactNode }) {
  const items = useToastRecords()
  const canPortal = typeof document !== 'undefined'
  return (
    <>
      {children}
      {canPortal ? createPortal(
        <div className="rh-toasts" role="region" aria-label="通知" aria-live="polite">
          {items.map((item) => (
            <div key={item.id} className={clsx('rh-toast', `rh-toast--${item.level}`)} role="status">
              <span className="rh-toast__bar" aria-hidden="true" />
              <div className="rh-toast__body">
                {item.caption ? <span className="rh-caption rh-toast__caption">{item.caption}</span> : null}
                <span className="rh-toast__message">{item.message}</span>
              </div>
              <button type="button" className="rh-toast__close" aria-label="关闭通知" onClick={() => toast.dismiss(item.id)}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
