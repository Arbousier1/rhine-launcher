/** 实例体检 — 一个页面、一条路由、一个插件。 */
import { defineFeature } from '../../define.ts'
import Page from '@/pages/diagnostics/DiagnosticsPage.tsx'

export default defineFeature({
  id: 'view.diagnostics',
  capability: 'view.diagnostics',
  title: '实例体检',
  description: '检查日志与环境，给出可执行的启动建议。',
  kind: 'view',
  route: {
    path: '/diagnostics',
    group: 'aux',
    order: 50,
    titleKey: 'nav.diagnostics',
    caption: 'DIAGNOSTICS',
    icon: 'logs',
  },
  optionalDepends: [],
  render: Page,
})
