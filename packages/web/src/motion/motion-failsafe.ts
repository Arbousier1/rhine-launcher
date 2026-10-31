/**
 * Motion failsafe.
 *
 * Some environments never deliver animation frames: headless screenshot
 * runners, remote-desktop browsers with the compositor disabled, a tab that is
 * still hidden. CSS intro animations with `fill-mode: both` would then freeze
 * on their invisible first keyframe and the page would look broken.
 *
 * We probe requestAnimationFrame once at startup. If frames do not arrive, the
 * document is marked `data-motion="static"` and the stylesheet disables
 * animation/transition entirely, so every element renders in its final state.
 * Real browsers reply within one frame and keep the full motion design.
 */
import { isBrowser } from './reduced-motion.ts'

const PROBE_MS = 620
/** Below this many frames in the probe window the environment is static. */
const MIN_FRAMES = 6

/** True when the current document has motion disabled by the failsafe. */
export function isStaticMotion(): boolean {
  if (!isBrowser()) return true
  return document.documentElement.dataset.motion === 'static'
}

/**
 * Start the probe. Called once from main.tsx before React mounts.
 * Repeated calls are cheap and idempotent.
 */
export function installMotionFailsafe(probeMs: number = PROBE_MS): void {
  if (!isBrowser() || typeof document.documentElement.dataset.motion === 'string') return

  let frames = 0
  let handle = 0
  let stopped = false
  const tick = () => {
    if (stopped) return
    frames += 1
    handle = requestAnimationFrame(tick)
  }
  handle = requestAnimationFrame(tick)

  window.setTimeout(() => {
    stopped = true
    if (handle) cancelAnimationFrame(handle)
    // A hidden tab legitimately delivers no frames; do not punish it for that.
    if (document.visibilityState !== 'visible') return
    if (frames >= MIN_FRAMES) return
    document.documentElement.dataset.motion = 'static'
  }, probeMs)
}