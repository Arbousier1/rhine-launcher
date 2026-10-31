/**
 * motion.card-expand — the card → detail FLIP and clip-path expansion.
 *
 * It owns the wrapper element of the detail page: enabling it makes the page
 * unfold out of the archive card that was clicked; disabling it leaves the
 * plain page container behind.
 */
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { defineFeature } from '../../define.ts'
import { useCardExpand } from '@/motion/transition.ts'

export interface CardExpandProps {
  className?: string
  children?: ReactNode
}

function CardExpandRoot({ className, children }: CardExpandProps) {
  const ref = useRef<HTMLDivElement>(null)
  useCardExpand(ref)
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

export default defineFeature<CardExpandProps>({
  id: 'motion.card-expand',
  capability: 'motion.card-expand',
  title: '卡片展开',
  description: '进入详情时卡片做 FLIP 幽灵过渡，详情以 clip-path 从卡片矩形扩张。',
  kind: 'motion',
  slot: 'motion.card-expand',
  order: 70,
  render: CardExpandRoot,
})
