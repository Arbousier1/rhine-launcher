/**
 * motion.text-decrypt — archive-style decryption for titles and version ids.
 * Pages render it through the "motion.text-decrypt" slot with plain-text
 * fallbacks, so the label is always readable when the motion is switched off.
 */
import { defineFeature } from '../../define.ts'
import { ScrambleText } from '@/motion/scramble-text.tsx'
import type { ScrambleTextProps } from '@/motion/scramble-text.tsx'

export default defineFeature<ScrambleTextProps>({
  id: 'motion.text-decrypt',
  capability: 'motion.text-decrypt',
  title: '文字解密',
  description: '标题与版本号首次出现时由随机字符收敛；中文只做遮罩揭示，不参与抖动。',
  kind: 'motion',
  slot: 'motion.text-decrypt',
  order: 30,
  optionalDepends: ['motion.failsafe'],
  render: ScrambleText,
})
