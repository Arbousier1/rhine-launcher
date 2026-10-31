/**
 * shell.theme-cycle — the top-bar theme button (archive → midnight → light).
 * Its own feature: switching it off removes the button, not the top bar.
 */
import { defineFeature } from '../../define.ts'
import { IconButton } from '@/ui'
import { MoonIcon } from '@/ui/icons'
import { api } from '@/api/client'
import { useAppStore } from '@/app/data.ts'
import { applyTheme, useI18n } from '@/app/theme.ts'
import type { ThemeName } from '@/app/theme.ts'

const ORDER: readonly ThemeName[] = ['archive', 'midnight', 'light']

function ThemeCycleButton() {
  const { t } = useI18n()
  const theme = useAppStore((state) => state.settings?.theme)
  const current: ThemeName = theme === 'midnight' || theme === 'light' ? theme : 'archive'

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]
    applyTheme(next)
    useAppStore.setState((state) =>
      state.settings ? { settings: { ...state.settings, theme: next } } : {},
    )
    void api.settings.update({ theme: next }).catch(() => {
      /* the local preference still applies for this session */
    })
  }

  return (
    <IconButton label={t('shell.theme')} onClick={cycle} variant="plain">
      <MoonIcon />
    </IconButton>
  )
}

export default defineFeature({
  id: 'shell.theme-cycle',
  capability: 'shell.theme-cycle',
  title: '主题切换',
  description: '顶栏配色按钮，档案 / 午夜 / 日光三档循环并持久化。',
  kind: 'slot',
  slot: 'shell.topbar.primary',
  order: 10,
  render: ThemeCycleButton,
})
