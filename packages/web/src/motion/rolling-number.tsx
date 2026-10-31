/**
 * <RollingNumber /> — the slot-machine roll used for version numbers and
 * counters.
 *
 * The incoming text rises into place (380ms) while the outgoing one leaves;
 * the container width follows with a spring so a shorter value never leaves a
 * gap. CJK text is replaced directly (fade only) because a rolling Chinese
 * glyph looks like a glitch, not like an archive instrument.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { useOwnedEffect as useEffect } from '@/plugins/owned-effect.tsx'
import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { isBrowser, usePrefersReducedMotion } from './reduced-motion.ts'

export interface RollingNumberProps {
  value: string | number
  className?: string
  /** Roll duration in ms. */
  duration?: number
  style?: CSSProperties
  ariaLabel?: string
}

const useIsoLayoutEffect = isBrowser() ? useLayoutEffect : useEffect

const ASCII_ONLY = /^[\x20-\x7e]*$/

export function RollingNumber({ value, className, duration = 380, style, ariaLabel }: RollingNumberProps) {
  const text = String(value)
  const reduced = usePrefersReducedMotion()
  const sizerRef = useRef<HTMLSpanElement | null>(null)
  const currentRef = useRef(text)
  const [previous, setPrevious] = useState<string | null>(null)
  const [width, setWidth] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (currentRef.current === text) return
    const before = currentRef.current
    currentRef.current = text
    if (reduced || !isBrowser()) {
      setPrevious(null)
      return
    }
    setPrevious(before)
    const timer = window.setTimeout(() => setPrevious(null), duration + 80)
    return () => window.clearTimeout(timer)
  }, [text, duration, reduced])

  useIsoLayoutEffect(() => {
    const sizer = sizerRef.current
    if (!sizer) return
    const measure = () => {
      const next = sizer.getBoundingClientRect().width
      setWidth(next > 0 ? Math.ceil(next) : undefined)
    }
    measure()
    // A late webfont swap changes the natural width; re-measure once it lands.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.ready?.then === 'function') void fonts.ready.then(measure)
  }, [text])

  const rolling = previous !== null && ASCII_ONLY.test(previous) && ASCII_ONLY.test(text)

  return (
    <span
      className={clsx('rh-roll', previous !== null && rolling && 'is-rolling', previous !== null && !rolling && 'is-fading', className)}
      style={{ ...style, width: width ? width + 'px' : undefined }}
      aria-label={ariaLabel ?? text}
    >
      <span ref={sizerRef} className="rh-roll__sizer" aria-hidden="true">
        {text}
      </span>
      {previous !== null ? (
        <span key={'out:' + previous} className="rh-roll__layer is-out" aria-hidden="true">
          {previous}
        </span>
      ) : null}
      <span
        key={'in:' + text}
        className={clsx('rh-roll__layer', previous !== null ? 'is-in' : 'is-idle')}
        aria-hidden="true"
      >
        {text}
      </span>
    </span>
  )
}
