/**
 * view.market — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import MarketPage from '@/pages/market/MarketPage.tsx'

export default defineFeature({
  id: 'view.market',
  capability: 'view.market',
  title: '市场',
  description: 'Modrinth / CurseForge 资源搜索与安装。',
  kind: 'view',
  route: {
    path: '/market',
    group: 'main',
    order: 40,
    titleKey: 'nav.market',
    caption: 'MARKET',
    icon: 'market',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: MarketPage,
})
