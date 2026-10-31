/**
 * Route transitions.
 *
 * `useRouteTransition` drives a tiny out → in sequence: the outgoing view is
 * held for 120ms while it fades and drifts 8px, then the router is pointed at
 * the new location and that view fades in over 180ms. Reduced motion skips
 * straight to the destination.
 */
import { useEffect, useState } from 'react'
import type { Location } from 'react-router-dom'
import { isBrowser, usePrefersReducedMotion } from './reduced-motion.ts'

export const ROUTE_EXIT_MS = 120
export const ROUTE_ENTER_MS = 190

export type RoutePhase = 'idle' | 'out' | 'in'

export interface RouteTransitionState {
  /** The location the router should render. */
  location: Location
  phase: RoutePhase
}

export function useRouteTransition(location: Location): RouteTransitionState {
  const reduced = usePrefersReducedMotion()
  const [display, setDisplay] = useState<Location>(location)
  const [phase, setPhase] = useState<RoutePhase>('idle')

  useEffect(() => {
    if (reduced) {
      setDisplay(location)
      setPhase('idle')
      return
    }
    if (location.key === display.key) return
    if (!isBrowser()) {
      setDisplay(location)
      return
    }
    setPhase('out')
  }, [location, display.key, reduced])

  useEffect(() => {
    if (phase !== 'out') return
    const timer = window.setTimeout(() => {
      setDisplay(location)
      setPhase('in')
    }, ROUTE_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [phase, location])

  useEffect(() => {
    if (phase !== 'in') return
    const timer = window.setTimeout(() => setPhase('idle'), ROUTE_ENTER_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  return { location: display, phase }
}
