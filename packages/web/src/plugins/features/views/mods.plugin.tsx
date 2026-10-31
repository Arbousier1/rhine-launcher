/**
 * view.mods — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import ModsPage from '@/pages/mods/ModsPage.tsx'

export default defineFeature({
  id: 'view.mods',
  capability: 'view.mods',
  title: '模组',
  description: '实例 mods 目录管理、启停与更新检查。',
  kind: 'view',
  route: {
    path: '/mods',
    group: 'main',
    order: 30,
    titleKey: 'nav.mods',
    caption: 'MODS',
    icon: 'mods',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: ModsPage,
})
