/** 整合包与迁移 — 一个页面、一条路由、一个插件。 */
import { defineFeature } from '../../define.ts'
import Page from '@/pages/modpacks/ModpackPage.tsx'

export default defineFeature({
  id: 'view.modpacks',
  capability: 'view.modpacks',
  title: '整合包与迁移',
  description: '导入整合包或复制实例，对应 XMCL 的迁移向导能力。',
  kind: 'view',
  route: {
    path: '/modpacks',
    group: 'main',
    order: 15,
    titleKey: 'nav.modpacks',
    caption: 'MIGRATE',
    icon: 'logs',
  },
  optionalDepends: [],
  render: Page,
})
