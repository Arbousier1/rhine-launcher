/**
 * Read-only display components: sparkline, empty state, tooltip and the
 * archive's signature hairline stat grid.
 */
import clsx from 'clsx'
import type { ComponentProps, ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

export interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  tone?: 'accent' | 'muted'
  className?: string
  ariaLabel?: string
  /** Fill the area under the line. */
  area?: boolean
}

export function Sparkline({
  data,
  width = 96,
  height = 24,
  tone = 'accent',
  className,
  ariaLabel,
  area = false,
}: SparklineProps) {
  const points = data.filter((n) => Number.isFinite(n))
  const gradientId = useId().replace(/:/g, '')
  if (points.length < 2) {
    return <span className={clsx('rh-sparkline is-empty', className)} style={{ width, height }} aria-hidden="true" />
  }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = width / (points.length - 1)
  const coords = points.map((value, index) => {
    const x = index * stepX
    const y = height - ((value - min) / span) * (height - 2) - 1
    return [x, y] as const
  })
  const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const fill = `${line} L${width} ${height} L0 ${height} Z`

  return (
    <svg
      className={clsx('rh-sparkline', `rh-sparkline--${tone}`, className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      preserveAspectRatio="none"
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="1.6" fill="currentColor" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  caption?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
  /** Compact variant for inline placement inside a panel. */
  compact?: boolean
}

export function EmptyState({ title, description, caption, action, icon, className, compact }: EmptyStateProps) {
  return (
    <div className={clsx('rh-empty', compact && 'rh-empty--compact', className)}>
      <div className="rh-empty__icon" aria-hidden="true">
        {icon ?? <ArchiveGlyph />}
      </div>
      {caption ? <span className="rh-empty__caption rh-caption">{caption}</span> : null}
      <p className="rh-empty__title">{title}</p>
      {description ? <p className="rh-empty__desc">{description}</p> : null}
      {action ? <div className="rh-empty__action">{action}</div> : null}
    </div>
  )
}

function ArchiveGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="4.5" y="9.5" width="25" height="19" />
      <path d="M4.5 9.5L8 4.5h18l3.5 5" />
      <path d="M13.5 15.5h7" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
  className?: string
  /** Delay before showing, in ms. */
  delay?: number
}

export function Tooltip({ content, side = 'top', children, className, delay = 220 }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId().replace(/:/g, '')

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
    setOpen(false)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <span
      className={clsx('rh-tooltip-host', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={open ? `tip-${id}` : undefined}
    >
      {children}
      {open && content ? (
        <span role="tooltip" id={`tip-${id}`} className={clsx('rh-tooltip', `rh-tooltip--${side}`)}>
          {content}
        </span>
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* StatGrid / DefinitionList                                           */
/* ------------------------------------------------------------------ */

export interface StatItem {
  label: ReactNode
  caption?: ReactNode
  value: ReactNode
  hint?: ReactNode
}

export function StatGrid({ items, className, columns }: { items: StatItem[]; className?: string; columns?: number }) {
  return (
    <div
      className={clsx('rh-statgrid', className)}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {items.map((item, index) => (
        <div className="rh-statgrid__cell" key={index}>
          {item.caption ? <span className="rh-caption rh-statgrid__caption">{item.caption}</span> : null}
          <span className="rh-statgrid__label">{item.label}</span>
          <span className="rh-statgrid__value rh-num">{item.value}</span>
          {item.hint ? <span className="rh-statgrid__hint">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  )
}

export function DefinitionList({ className, ...rest }: ComponentProps<'dl'>) {
  return <dl {...rest} className={clsx('rh-dl', className)} />
}

export function DefinitionItem({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt className="rh-dl__term rh-caption">{term}</dt>
      <dd className="rh-dl__desc">{children}</dd>
    </>
  )
}
