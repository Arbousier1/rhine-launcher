/** 模组更新 — 一个页面、一条路由、一个插件。 */
import { defineFeature } from '../../define.ts'
import Page from '@/pages/mods/ModUpdatesPage.tsx'

export default defineFeature({
  id: 'view.mod-updates',
  capability: 'view.mod-updates',
  title: '模组更新',
  description: '检查并批量更新实例内模组，对应 XMCL 的 Mod 更新能力。',
  kind: 'view',
  route: {
    path: '/mod-updates',
    group: 'aux',
    order: 55,
    titleKey: 'nav.mod-updates',
    caption: 'MOD UPDATES',
    icon: 'mods',
  },
  optionalDepends: [],
  render: Page,
})
