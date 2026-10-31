/**
 * Motion layer tests.
 *
 * Three groups:
 * 1. the pure timeline/scramble math (no DOM at all),
 * 2. the session-storage boot flag (must never throw without a window),
 * 3. server rendering of every motion component, which is the guard that
 *    matters most: these components ship inside the archive pages, so a
 *    document/window access at render time would break the whole suite.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  BOOT_DURATION_MS,
  bootFrameAt,
  bootPhaseAt,
  hasBootPlayed,
  markBootPlayed,
} from '../src/boot/boot-sequence.ts'
import { charReveal, isConverged, isScrambleSafe, scrambleFrame } from '../src/motion/scramble.ts'
import { ArchiveCore } from '../src/motion/archive-core.tsx'
import { ArchiveCoreLite } from '../src/motion/archive-core-lite.tsx'
import { Dust } from '../src/motion/dust.tsx'
import { RollingNumber } from '../src/motion/rolling-number.tsx'
import { ScanLine } from '../src/motion/scanline.tsx'
import { ScrambleText } from '../src/motion/scramble-text.tsx'

describe('boot timeline', () => {
  it('stays inside the 1.6–2.2 second budget', () => {
    expect(BOOT_DURATION_MS).toBeGreaterThanOrEqual(1600)
    expect(BOOT_DURATION_MS).toBeLessThanOrEqual(2200)
  })

  it('walks through every phase in order', () => {
    expect(bootPhaseAt(0)).toBe('dark')
    expect(bootPhaseAt(200)).toBe('scan')
    expect(bootPhaseAt(900)).toBe('decrypt')
    expect(bootPhaseAt(1500)).toBe('converge')
    expect(bootPhaseAt(1800)).toBe('flash')
    expect(bootPhaseAt(BOOT_DURATION_MS)).toBe('flash')
  })

  it('clamps out-of-range and non-finite times', () => {
    expect(bootPhaseAt(-500)).toBe('dark')
    expect(bootPhaseAt(99_999)).toBe('flash')
    expect(bootPhaseAt(Number.NaN)).toBe('dark')
  })

  it('produces monotonically increasing progress values', () => {
    let previous = bootFrameAt(0)
    for (let t = 40; t <= BOOT_DURATION_MS; t += 40) {
      const frame = bootFrameAt(t)
      expect(frame.progress).toBeGreaterThanOrEqual(previous.progress)
      expect(frame.scan).toBeGreaterThanOrEqual(previous.scan)
      expect(frame.reveal).toBeGreaterThanOrEqual(previous.reveal)
      expect(frame.rule).toBeGreaterThanOrEqual(previous.rule)
      expect(frame.flash).toBeGreaterThanOrEqual(previous.flash)
      previous = frame
    }
    expect(previous.flash).toBe(1)
    expect(previous.progress).toBe(1)
  })

  it('keeps the brand hidden during the dark and scan passes', () => {
    expect(bootFrameAt(0).brand).toBe(0)
    expect(bootFrameAt(300).brand).toBe(0)
    expect(bootFrameAt(1000).brand).toBe(1)
  })

  it('never touches sessionStorage without a window', () => {
    expect(hasBootPlayed()).toBe(false)
    expect(() => markBootPlayed()).not.toThrow()
  })
})

describe('scramble text', () => {
  it('only scrambles printable ASCII', () => {
    expect(isScrambleSafe('A')).toBe(true)
    expect(isScrambleSafe('7')).toBe(true)
    expect(isScrambleSafe('档')).toBe(false)
    expect(isScrambleSafe(' ')).toBe(false)
  })

  it('converges exactly on the target at progress 1', () => {
    for (const text of ['RHINE', 'ARCHIVE / INSTANCES', '档案库', 'v1.20.1']) {
      expect(scrambleFrame(text, 1, 5)).toBe(text)
      expect(isConverged(text, 1)).toBe(true)
    }
  })

  it('leaves CJK untouched while the latin part is still noise', () => {
    const frame = scrambleFrame('版本 RHINE', 0.3, 2)
    expect(frame.startsWith('版本 ')).toBe(true)
    expect(frame).not.toContain('RHINE')
  })

  it('is deterministic for the same seed and frame', () => {
    expect(scrambleFrame('RHINE', 0.4, 9)).toBe(scrambleFrame('RHINE', 0.4, 9))
    expect(scrambleFrame('RHINE', 0.4, 9)).not.toBe(scrambleFrame('RHINE', 0.4, 10))
  })

  it('reveals the head before the tail', () => {
    const length = 8
    expect(charReveal(0, length, 0.4)).toBeGreaterThan(charReveal(7, length, 0.4))
    expect(charReveal(0, length, 0)).toBe(0)
    expect(charReveal(0, length, 1)).toBe(1)
  })
})

describe('motion components render on the server', () => {
  it('renders ScrambleText with the final label', () => {
    const html = renderToStaticMarkup(createElement(ScrambleText, { text: 'ARCHIVE' }))
    expect(html).toContain('rh-scramble')
    expect(html).toContain('ARCHIVE')
    expect(html).toContain('aria-label="ARCHIVE"')
  })

  it('renders ScrambleText with CJK masked characters', () => {
    const html = renderToStaticMarkup(createElement(ScrambleText, { text: '档案库' }))
    expect(html).toContain('档案库')
    expect(html).toContain('rh-scramble__mask')
  })

  it('renders RollingNumber with its value and sizer', () => {
    const html = renderToStaticMarkup(createElement(RollingNumber, { value: '1.21.4' }))
    expect(html).toContain('rh-roll')
    expect(html).toContain('1.21.4')
    expect(html).toContain('rh-roll__sizer')
  })

  it('renders Dust with the requested number of specks', () => {
    const html = renderToStaticMarkup(createElement(Dust, { count: 24 }))
    expect(html.match(/rh-dust__mote/g)?.length).toBe(24)
  })

  it('renders a scan line with the requested period', () => {
    const html = renderToStaticMarkup(createElement(ScanLine, { period: 6 }))
    expect(html).toContain('rh-scanline')
    expect(html).toContain('animation-duration:6s')
  })

  it('renders the CSS core and the WebGL host without a canvas context', () => {
    const html = renderToStaticMarkup(createElement(ArchiveCore, { label: '档案核心' }))
    expect(html).toContain('rh-core')
    expect(html).toContain('rh-core-lite')
    expect(html).toContain('rh-core__canvas')
    expect(html).toContain('aria-label="档案核心"')
    // SSR never marks the scene live: the fallback stays visible.
    expect(html).not.toContain('is-live')
  })

  it('renders the lifted CSS fallback', () => {
    const html = renderToStaticMarkup(createElement(ArchiveCoreLite, { lifted: true }))
    expect(html).toContain('rh-core-lite is-lifted')
  })
})
