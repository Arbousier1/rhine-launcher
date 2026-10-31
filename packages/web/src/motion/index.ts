/**
 * Public surface of the motion layer.
 *
 * Pages import from '@/motion' only; the CSS is pulled in once here so every
 * consumer (and the app shell) gets the same animation classes.
 */
import './motion.css'

export { ArchiveCore, supportsWebGL } from './archive-core.tsx'
export type { ArchiveCoreProps } from './archive-core.tsx'
export { ArchiveCoreLite } from './archive-core-lite.tsx'
export type { ArchiveCoreLiteProps } from './archive-core-lite.tsx'
export { Dust } from './dust.tsx'
export type { DustProps } from './dust.tsx'
export { RollingNumber } from './rolling-number.tsx'
export type { RollingNumberProps } from './rolling-number.tsx'
export { ScanLine } from './scanline.tsx'
export type { ScanLineProps } from './scanline.tsx'
export { ScrambleText } from './scramble-text.tsx'
export type { ScrambleTextProps } from './scramble-text.tsx'
export { ROUTE_ENTER_MS, ROUTE_EXIT_MS, useRouteTransition } from './route-transition.ts'
export type { RoutePhase, RouteTransitionState } from './route-transition.ts'
export {
  clearFlip, expandFromRect, playFlipGhost, rememberFlip, snapshotRect, takeFlip, useCardExpand,
} from './transition.ts'
export type { RectSnapshot } from './transition.ts'
export {
  clamp01, damp, isBrowser, prefersReducedMotion, usePrefersReducedMotion,
} from './reduced-motion.ts'
export { installMotionFailsafe, isStaticMotion } from './motion-failsafe.ts'
export { charReveal, isConverged, isScrambleSafe, scrambleFrame, scrambleGlyph } from './scramble.ts'