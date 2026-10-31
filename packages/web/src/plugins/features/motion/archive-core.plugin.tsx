/**
 * motion.archive-core — the three.js archive core (with its CSS fallback).
 *
 * All WebGL resources live inside the component; unmounting this plugin
 * disposes the renderer, the listeners and the rAF loop.
 */
import { defineFeature } from '../../define.ts'
import { ArchiveCore } from '@/motion/archive-core.tsx'
import type { ArchiveCoreProps } from '@/motion/archive-core.tsx'

export default defineFeature<ArchiveCoreProps>({
  id: 'motion.archive-core',
  capability: 'motion.archive-core',
  title: '三维档案核心',
  description: '磨砂玻璃罩 / 琥珀光导 / 环形槽的 three.js 场景，含指针视差与 CSS 降级。',
  kind: 'motion',
  slot: 'motion.archive-core',
  order: 20,
  tags: ['webgl'],
  render: ArchiveCore,
})
