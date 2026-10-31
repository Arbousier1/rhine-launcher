/**
 * view.logs — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import LogsPage from '@/pages/logs/LogsPage.tsx'

export default defineFeature({
  id: 'view.logs',
  capability: 'view.logs',
  title: '日志',
  description: '启动任务与实时日志。',
  kind: 'view',
  route: {
    path: '/logs',
    group: 'aux',
    order: 20,
    titleKey: 'nav.logs',
    caption: 'LOGS',
    icon: 'logs',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: LogsPage,
})
