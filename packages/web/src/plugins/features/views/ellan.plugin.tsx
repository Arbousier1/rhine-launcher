/**
 * view.ellan — 艾尔岚风格主页，默认落地页。
 *
 * 只复刻可见 UI；数据来自本启动器真实能力。
 */
import { defineFeature } from '../../define.ts'
import EllanPage from '@/pages/ellan/EllanPage.tsx'

export default defineFeature({
  id: 'view.ellan',
  capability: 'view.ellan',
  title: '艾尔岚主页',
  description: '艾尔岚风格的卡片仪表盘主页：状态、账号、模组与实例一览。',
  kind: 'view',
  route: {
    path: '/',
    group: 'main',
    order: 5,
    titleKey: 'nav.ellan',
    caption: 'ELLAN',
    icon: 'home',
    aliases: ['/ellan'],
  },
  optionalDepends: [],
  render: EllanPage,
})
