/**
 * motion.boot — the archive boot sequence and the paper curtain.
 *
 * It reads the bootstrap state itself; the shell only renders the slot. Now
 * that the overlay is additive, switching this feature off simply starts the
 * launcher directly in the shell.
 */
import { useCallback, useState } from 'react'
import { defineFeature } from '../../define.ts'
import { BootScreen } from '@/boot/BootScreen.tsx'
import { useAppStore } from '@/app/data.ts'
import { useI18n } from '@/app/theme.ts'

function BootFeature() {
  const { t } = useI18n()
  const status = useAppStore((state) => state.status)
  const error = useAppStore((state) => state.error)
  const app = useAppStore((state) => state.app)
  const reload = useAppStore((state) => state.reload)
  const [busy, setBusy] = useState(false)

  const retry = useCallback(async () => {
    setBusy(true)
    try {
      await reload()
    } finally {
      setBusy(false)
    }
  }, [reload])

  const ready = !(status === 'idle' || (status === 'loading' && !app) || (status === 'error' && !app))

  return (
    <BootScreen
      t={t}
      ready={ready}
      error={status === 'error' ? error : null}
      onRetry={() => void retry()}
      busy={busy}
    />
  )
}

export default defineFeature({
  id: 'motion.boot',
  capability: 'motion.boot',
  title: '启动序列',
  description: '黑场 → 扫描线 → 品牌字解密 → 白场闪入 → 纸张幕布淡出；会话内只播放一次。',
  kind: 'motion',
  slot: 'motion.boot',
  order: 5,
  optionalDepends: ['motion.failsafe'],
  render: BootFeature,
})
