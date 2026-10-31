/**
 * Environment + motion-preference helpers.
 *
 * Every motion component in this folder is safe to render on the server: the
 * guards below are the only place that touches `window`, and effects never run
 * during static rendering, so the SSR tests keep seeing final-state markup.
 */
import { useEffect, useState } from 'react'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

/** True only when a real browser document is available. */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/** One-shot read of the reduce-motion preference (false during SSR). */
export function prefersReducedMotion(): boolean {
  if (!isBrowser() || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(REDUCED_QUERY).matches
  } catch {
    return false
  }
}

/** Reactive reduce-motion preference. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion())

  useEffect(() => {
    if (!isBrowser() || typeof window.matchMedia !== 'function') return
    let query: MediaQueryList
    try {
      query = window.matchMedia(REDUCED_QUERY)
    } catch {
      return
    }
    const onChange = () => setReduced(query.matches)
    onChange()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    // Safari < 14
    query.addListener(onChange)
    return () => query.removeListener(onChange)
  }, [])

  return reduced
}

/** Frame-rate independent exponential damping. */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * delta))
}

/** Clamp a number into the 0..1 range. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
