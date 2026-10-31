/**
 * shell.locale-cycle — the top-bar language button (中文 / English).
 */
import { defineFeature } from '../../define.ts'
import { LOCALE_LABELS, LOCALES } from '@/app/i18n.ts'
import { useI18n } from '@/app/theme.ts'

function LocaleCycleButton() {
  const { locale, setLocale } = useI18n()
  const cycle = () => {
    setLocale(LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length])
  }
  return (
    <button type="button" className="rh-btn rh-btn--quiet rh-btn--sm" onClick={cycle}>
      {LOCALE_LABELS[locale]}
    </button>
  )
}

export default defineFeature({
  id: 'shell.locale-cycle',
  capability: 'shell.locale-cycle',
  title: '语言切换',
  description: '顶栏中英文切换按钮，只影响本次会话。',
  kind: 'slot',
  slot: 'shell.topbar.primary',
  order: 20,
  render: LocaleCycleButton,
})
