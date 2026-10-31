/**
 * view.settings — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import SettingsPage from '@/pages/settings/SettingsPage.tsx'

export default defineFeature({
  id: 'view.settings',
  capability: 'view.settings',
  title: '设置',
  description: '全局设置、主题、语言与数据目录。',
  kind: 'view',
  route: {
    path: '/settings',
    group: 'aux',
    order: 30,
    titleKey: 'nav.settings',
    caption: 'SETTINGS',
    icon: 'settings',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: SettingsPage,
})
