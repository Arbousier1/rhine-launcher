/**
 * view.accounts — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import AccountsPage from '@/pages/accounts/AccountsPage.tsx'

export default defineFeature({
  id: 'view.accounts',
  capability: 'view.accounts',
  title: '账号',
  description: '离线账号、微软设备码登录与外置登录。',
  kind: 'view',
  route: {
    path: '/accounts',
    group: 'main',
    order: 50,
    titleKey: 'nav.accounts',
    caption: 'ACCOUNTS',
    icon: 'accounts',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: AccountsPage,
})
