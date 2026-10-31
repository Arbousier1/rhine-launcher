/**
 * <ScrambleText /> — archive-style decryption for short labels.
 *
 * Latin characters converge from random glyphs; CJK characters never flicker,
 * they are uncovered by a width mask. The first frame after mount is noise and
 * the final frame is the exact `text`, so the animation is invisible to
 * assistive tech (the wrapper keeps the real string as its label) and harmless
 * to server rendering (progress starts at 1 there).
 */
import { useMemo, useRef, useState } from 'react'
import { useOwnedEffect as useEffect } from '@/plugins/owned-effect.tsx'
import clsx from 'clsx'
import type { CSSProperties, ElementType } from 'react'
import { isBrowser, usePrefersReducedMotion } from './reduced-motion.ts'
import { charReveal, isScrambleSafe, scrambleGlyph } from './scramble.ts'

export interface ScrambleTextProps {
  text: string
  /** Total decryption time in ms (200–400 reads best). */
  duration?: number
  /** Delay before the effect starts, in ms. */
  delay?: number
  className?: string
  style?: CSSProperties
  as?: ElementType
  /** Replays the effect whenever this value changes. */
  trigger?: string | number
}

export function ScrambleText({
  text,
  duration = 320,
  delay = 0,
  className,
  style,
  as: Tag = 'span',
  trigger,
}: ScrambleTextProps) {
  const reduced = usePrefersReducedMotion()
  const [progress, setProgress] = useState<number>(() => (isBrowser() ? 0 : 1))
  const frameRef = useRef(0)

  useEffect(() => {
    if (!isBrowser() || reduced || text.length === 0) {
      setProgress(1)
      return
    }
    let raf = 0
    let timer = 0
    const start = () => {
      const begin = performance.now()
      const tick = (now: number) => {
        const ratio = duration <= 0 ? 1 : Math.min(1, (now - begin) / duration)
        setProgress(ratio)
        if (ratio < 1) {
          raf = requestAnimationFrame(tick)
        }
      }
      setProgress(0)
      raf = requestAnimationFrame(tick)
    }
    if (delay > 0) {
      timer = window.setTimeout(start, delay)
    } else {
      start()
    }
    // If frames never arrive (hidden tab, headless capture) the label must
    // still converge instead of sitting on the noise frame forever.
    const settle = window.setTimeout(() => setProgress(1), delay + duration + 140)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (timer) window.clearTimeout(timer)
      window.clearTimeout(settle)
    }
    // `trigger` is an intentional replay key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, duration, delay, reduced, trigger])

  const chars = useMemo(() => Array.from(text), [text])
  frameRef.current = Math.floor(Math.min(1, Math.max(0, progress)) * 32)

  return (
    <Tag className={clsx('rh-scramble', className)} style={style} aria-label={text} title={text}>
      <span className="rh-scramble__inner" aria-hidden="true">
        {chars.map((char, index) => {
          const reveal = charReveal(index, chars.length, progress)
          if (char === ' ') return <span key={index}> </span>
          if (!isScrambleSafe(char)) {
            return (
              <span
                key={index}
                className="rh-scramble__mask"
                style={{ '--rh-reveal': String(reveal) } as CSSProperties}
              >
                {char}
              </span>
            )
          }
          return (
            <span key={index} className={clsx('rh-scramble__char', reveal >= 1 && 'is-done')}>
              {reveal >= 1 ? char : scrambleGlyph(index, frameRef.current)}
            </span>
          )
        })}
      </span>
    </Tag>
  )
}
