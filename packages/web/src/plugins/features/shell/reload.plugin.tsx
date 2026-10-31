/**
 * shell.reload — re-fetches the bootstrap and re-enters the current route.
 */
import { useState } from 'react'
import { defineFeature } from '../../define.ts'
import { IconButton } from '@/ui'
import { useAppStore } from '@/app/data.ts'
import { useI18n } from '@/app/theme.ts'
import { useLocation, useNavigate } from 'react-router-dom'

function ReloadButton() {
  const { t } = useI18n()
  const reload = useAppStore((state) => state.reload)
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      await reload()
      navigate(location.pathname)
    } finally {
      setBusy(false)
    }
  }

  return (
    <IconButton label={t('shell.reload')} variant="plain" onClick={() => void run()}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.16" stroke="currentColor" strokeWidth="1" />
        <path d="M13.5 1.5v3.2h-3.2" stroke="currentColor" strokeWidth="1" />
      </svg>
    </IconButton>
  )
}

export default defineFeature({
  id: 'shell.reload',
  capability: 'shell.reload',
  title: '刷新数据',
  description: '顶栏刷新按钮：重新拉取 bootstrap 并回到当前路由。',
  kind: 'slot',
  slot: 'shell.topbar.tools',
  order: 20,
  render: ReloadButton,
})
