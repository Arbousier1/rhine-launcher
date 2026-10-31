/**
 * view.versions — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import VersionsPage from '@/pages/versions/VersionsPage.tsx'

export default defineFeature({
  id: 'view.versions',
  capability: 'view.versions',
  title: '版本',
  description: '远程版本清单、已安装版本与加载器构建浏览。',
  kind: 'view',
  route: {
    path: '/versions',
    group: 'main',
    order: 20,
    titleKey: 'nav.versions',
    caption: 'VERSIONS',
    icon: 'versions',
  },
  optionalDepends: ['motion.rolling-number', 'motion.text-decrypt'],
  render: VersionsPage,
})
