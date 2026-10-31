/**
 * motion.failsafe — headless: degrade to static styles when the environment
 * never delivers animation frames (headless capture, stalled compositor, a
 * hidden tab). It prevents full-screen intro animations from freezing on their
 * invisible first keyframe.
 *
 * The document attribute it adds is removed again through env.onDispose().
 */
import { defineFeature } from '../../define.ts'
import { installMotionFailsafe } from '@/motion/motion-failsafe.ts'

export default defineFeature({
  id: 'motion.failsafe',
  capability: 'motion.failsafe',
  title: '静帧兜底',
  description: '检测不到动画帧时把界面退化为静态终态；恢复动画能力后自动撤销。',
  kind: 'effect',
  order: 5,
  setup(env) {
    installMotionFailsafe()
    env.onDispose(() => {
      if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-motion')
    })
  },
})
