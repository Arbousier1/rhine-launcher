/**
 * Boot sequence timeline.
 *
 * Pure frame math (no DOM, no React) so the timing can be unit tested:
 *
 *   0.00 – 0.12s  ink field, nothing on screen
 *   0.12 – 0.56s  hairline scanner crosses the field
 *   0.54 – 1.40s  brand characters decrypt (scramble → RHINE / LAUNCHER)
 *   1.40 – 1.68s  everything converges, rule fills
 *   1.68 – 1.96s  the white field flashes in
 *
 * Total 1.96s, inside the 1.6–2.2s budget.
 */

export const BOOT_DURATION_MS = 1960
export const BOOT_STORAGE_KEY = 'rhine.boot.seen'

export type BootPhase = 'dark' | 'scan' | 'decrypt' | 'converge' | 'flash' | 'quiet'

export const BOOT_PHASES = [
  { key: 'dark', from: 0, to: 120 },
  { key: 'scan', from: 120, to: 560 },
  { key: 'decrypt', from: 560, to: 1400 },
  { key: 'converge', from: 1400, to: 1680 },
  { key: 'flash', from: 1680, to: BOOT_DURATION_MS },
] as const

export interface BootFrame {
  phase: BootPhase
  /** 0..1 across the whole sequence. */
  progress: number
  /** 0..1 scanner travel (top → bottom). */
  scan: number
  /** 0..1 brand character reveal. */
  reveal: number
  /** 0..1 brand opacity (so nothing shows during the dark pass). */
  brand: number
  /** 0..1 progress rule fill. */
  rule: number
  /** 0..1 white field opacity. */
  flash: number
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function ramp(value: number, from: number, to: number): number {
  if (to <= from) return value >= to ? 1 : 0
  return clamp((value - from) / (to - from), 0, 1)
}

/** Which named phase a point in time belongs to. */
export function bootPhaseAt(elapsed: number): BootPhase {
  const t = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, BOOT_DURATION_MS)
  for (const phase of BOOT_PHASES) {
    if (t < phase.to) return phase.key
  }
  return 'flash'
}

/** The complete visual state of the boot sequence at `elapsed` ms. */
export function bootFrameAt(elapsed: number): BootFrame {
  const t = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, BOOT_DURATION_MS)
  return {
    phase: bootPhaseAt(t),
    progress: t / BOOT_DURATION_MS,
    scan: ramp(t, 120, 560),
    reveal: ramp(t, 540, 1400),
    brand: ramp(t, 520, 740),
    rule: ramp(t, 200, 1400),
    flash: ramp(t, 1680, 1900),
  }
}

/** Has the sequence already played in this browser session? */
export function hasBootPlayed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(BOOT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Remember that this session has seen the sequence (refresh stays quiet). */
export function markBootPlayed(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(BOOT_STORAGE_KEY, '1')
  } catch {
    /* private mode: replaying the boot is harmless */
  }
}
