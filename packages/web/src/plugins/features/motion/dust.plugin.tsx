/**
 * motion.dust — the 1px archive motes. Mounted per surface through a slot, so
 * switching it off never touches the page that hosts it.
 */
import { defineFeature } from '../../define.ts'
import { Dust } from '@/motion/dust.tsx'
import type { DustProps } from '@/motion/dust.tsx'

export default defineFeature<DustProps>({
  id: 'motion.dust',
  capability: 'motion.dust',
  title: '微尘粒子',
  description: '20–40 个 1px 尘点缓慢漂浮，只使用 transform/opacity，reduced-motion 时移除。',
  kind: 'motion',
  slot: 'motion.dust',
  order: 50,
  render: Dust,
})
