/**
 * motion.route-transition — the out/in page transition.
 *
 * The host hands over the location and a render function, so the router keeps
 * working when this plugin is disabled (the fallback renders the same routes
 * without the 120ms exit frame).
 */
import type { ReactNode } from 'react'
import type { Location } from 'react-router-dom'
import { defineFeature } from '../../define.ts'
import { useRouteTransition } from '@/motion/route-transition.ts'

export interface RouteFrameProps {
  location: Location
  render: (location: Location) => ReactNode
}

function RouteFrame({ location, render }: RouteFrameProps) {
  const { location: displayed, phase } = useRouteTransition(location)
  const className = 'rh-route' + (phase === 'out' ? ' is-out' : phase === 'in' ? ' is-in' : '')
  return <div className={className}>{render(displayed)}</div>
}

export default defineFeature<RouteFrameProps>({
  id: 'motion.route-transition',
  capability: 'motion.route-transition',
  title: '路由过渡',
  description: '旧页 120ms 淡出上移 8px，新页 190ms 淡入；停用后直接切页。',
  kind: 'motion',
  slot: 'motion.route-transition',
  order: 10,
  optionalDepends: ['motion.failsafe'],
  render: RouteFrame,
})
