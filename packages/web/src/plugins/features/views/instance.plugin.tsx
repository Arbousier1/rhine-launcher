/**
 * view.instance — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import InstanceDetailPage from '@/pages/instances/InstanceDetailPage.tsx'

export default defineFeature({
  id: 'view.instance',
  capability: 'view.instance',
  title: '档案详情',
  description: '单份档案的规格、模组、日志与设置，进入时播放卡片展开。',
  kind: 'view',
  route: {
    path: '/instances/:id',
    hidden: true,
    group: 'main',
    order: 15,
    titleKey: 'nav.instance',
    caption: 'ARCHIVE',
    icon: 'archive',
  },
  optionalDepends: ['motion.card-expand', 'motion.dust', 'motion.scanline', 'motion.text-decrypt'],
  render: InstanceDetailPage,
})
