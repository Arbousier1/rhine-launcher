/**
 * Pure text-decryption helpers.
 *
 * The archive look is built on a very specific behaviour: latin characters are
 * *scrambled* (random glyphs converging on the target), while CJK characters
 * never flicker — they are revealed by a growing mask instead. Both rules live
 * here so they can be unit tested without a DOM.
 */

/** Glyphs used while a character has not converged yet. */
export const SCRAMBLE_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+-=/<>[]|'

/** Printable ASCII that is safe to replace with noise. */
export function isScrambleSafe(char: string): boolean {
  return char.length === 1 && char.charCodeAt(0) > 0x20 && char.charCodeAt(0) < 0x7f
}

/** Deterministic hash in [0, 1). */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2545f491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * Reveal progress (0..1) for one character: the head of the string converges
 * first and the tail trails by up to 55% of the total duration.
 */
export function charReveal(index: number, length: number, progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress
  if (length <= 1) return clamp(p * 1.55)
  const stagger = 0.55
  const trail = (index / (length - 1)) * stagger
  return clamp(p * (1 + stagger) - trail)
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** One scrambled glyph for a slot at a given animation frame. */
export function scrambleGlyph(index: number, frame: number, seed = 1): string {
  const pick = Math.floor(hash01(index + seed * 131, frame) * SCRAMBLE_GLYPHS.length)
  return SCRAMBLE_GLYPHS[pick] ?? '#'
}

/**
 * Render a target string at a given reveal progress.
 *
 * Latin characters become random glyphs until they converge, CJK/emoji are
 * passed through untouched (the component masks them) and spaces are kept.
 */
export function scrambleFrame(target: string, progress: number, seed = 1): string {
  const chars = Array.from(target)
  const frame = Math.floor(clamp(progress) * 32)
  let out = ''
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (char === ' ') {
      out += ' '
      continue
    }
    if (!isScrambleSafe(char)) {
      out += char
      continue
    }
    const reveal = charReveal(index, chars.length, progress)
    out += reveal >= 1 ? char : scrambleGlyph(index, frame, seed)
  }
  return out
}

/** True when the whole string has converged. */
export function isConverged(target: string, progress: number): boolean {
  const chars = Array.from(target)
  if (chars.length === 0) return true
  return charReveal(chars.length - 1, chars.length, progress) >= 1
}
