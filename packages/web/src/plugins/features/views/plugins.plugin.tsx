/**
 * view.plugins — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import PluginsPage from '@/pages/plugins/PluginsPage.tsx'

export default defineFeature({
  id: 'view.plugins',
  capability: 'view.plugins',
  title: '插件',
  description: '逐个启停界面功能与后端功能插件。',
  kind: 'view',
  route: {
    path: '/plugins',
    group: 'aux',
    order: 40,
    titleKey: 'nav.plugins',
    caption: 'PLUGINS',
    icon: 'plugins',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: PluginsPage,
})
