/**
 * view.archive — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import ArchivePage from '@/pages/instances/ArchivePage.tsx'

export default defineFeature({
  id: 'view.archive',
  capability: 'view.archive',
  title: '档案库',
  description: '返回原生莱茵游戏档案界面的入口；管理工具不再显示旧托盘。',
  kind: 'view',
  route: {
    path: '/',
    group: 'main',
    order: 10,
    titleKey: 'nav.archive',
    caption: 'ARCHIVE',
    icon: 'archive',
    aliases: ['/archive'],
  },
  optionalDepends: ['motion.archive-core', 'motion.dust', 'motion.scanline', 'motion.text-decrypt'],
  render: ArchivePage,
})
