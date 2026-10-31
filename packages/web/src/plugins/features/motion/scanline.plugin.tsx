/**
 * motion.scanline — the slow 1px light pass over panels and the top chrome.
 */
import { defineFeature } from '../../define.ts'
import { ScanLine } from '@/motion/scanline.tsx'
import type { ScanLineProps } from '@/motion/scanline.tsx'

export default defineFeature<ScanLineProps>({
  id: 'motion.scanline',
  capability: 'motion.scanline',
  title: '扫描光带',
  description: '顶部与详情面板边缘的 1px 光带，6–7 秒一次缓慢扫过。',
  kind: 'motion',
  slot: 'motion.scanline',
  order: 60,
  render: ScanLine,
})
