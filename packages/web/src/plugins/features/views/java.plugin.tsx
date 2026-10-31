/**
 * view.java — one page, one route, one plugin.
 *
 * The route path, the sidebar label and the top-bar eyebrow all come from this
 * descriptor; the shell never hard-codes a page list.
 */
import { defineFeature } from '../../define.ts'
import JavaPage from '@/pages/java/JavaPage.tsx'

export default defineFeature({
  id: 'view.java',
  capability: 'view.java',
  title: '运行时',
  description: 'Java 运行时扫描与选择。',
  kind: 'view',
  route: {
    path: '/java',
    group: 'aux',
    order: 10,
    titleKey: 'nav.java',
    caption: 'RUNTIME',
    icon: 'java',
  },
  optionalDepends: ['motion.text-decrypt'],
  render: JavaPage,
})
