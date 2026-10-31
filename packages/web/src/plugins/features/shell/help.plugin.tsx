/**
 * shell.help — the shortcut sheet plus its top-bar button and the "?" key.
 */
import { useEffect, useState } from 'react'
import { defineFeature } from '../../define.ts'
import { IconButton } from '@/ui'
import { KeyboardIcon } from '@/ui/icons'
import { useI18n } from '@/app/theme.ts'
import { ShortcutSheet } from '@/app/ShortcutSheet.tsx'

function HelpShortcuts() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true
      if (typing) return
      if (event.key === '?') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <IconButton label={t('shell.shortcuts')} variant="plain" onClick={() => setOpen(true)}>
        <KeyboardIcon />
      </IconButton>
      <ShortcutSheet open={open} onClose={() => setOpen(false)} t={t} />
    </>
  )
}

export default defineFeature({
  id: 'shell.help',
  capability: 'shell.help',
  title: '快捷键帮助',
  description: '顶栏问号按钮、快捷键面板与全局 "?" 键。',
  kind: 'slot',
  slot: 'shell.topbar.tools',
  order: 10,
  render: HelpShortcuts,
})
