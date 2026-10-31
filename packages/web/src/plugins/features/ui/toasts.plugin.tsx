/**
 * ui.toasts — the toast surface. A wrapper slot: when it is disabled every
 * toast.show() call still succeeds, it simply has nowhere to render.
 */
import type { ReactNode } from 'react'
import { defineFeature } from '../../define.ts'
import { ToastProvider } from '@/ui/toast.tsx'

function ToastsFrame({ children }: { children?: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

export default defineFeature({
  id: 'ui.toasts',
  capability: 'ui.toasts',
  title: '通知提示',
  description: '右下角通知栈；停用后 toast 调用仍安全，只是不再显示。',
  kind: 'slot',
  slot: 'ui.frame',
  order: 10,
  render: ToastsFrame,
})
