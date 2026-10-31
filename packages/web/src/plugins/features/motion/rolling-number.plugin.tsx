/**
 * motion.rolling-number — the slot-machine roll for version ids and counters.
 */
import { defineFeature } from '../../define.ts'
import { RollingNumber } from '@/motion/rolling-number.tsx'
import type { RollingNumberProps } from '@/motion/rolling-number.tsx'

export default defineFeature<RollingNumberProps>({
  id: 'motion.rolling-number',
  capability: 'motion.rolling-number',
  title: '滚动数字',
  description: '版本号 380ms 纵向滚动，宽度弹簧跟随；中文直接淡入替换。',
  kind: 'motion',
  slot: 'motion.rolling-number',
  order: 40,
  optionalDepends: ['motion.failsafe'],
  render: RollingNumber,
})
