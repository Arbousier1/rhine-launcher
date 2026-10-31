/**
 * Progress bar. A value below zero (or `indeterminate`) renders a scanning
 * amber sliver instead of a percentage.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'

export interface ProgressProps {
  /** 0..1; negative means "unknown total". */
  value: number
  label?: ReactNode
  indeterminate?: boolean
  tone?: 'accent' | 'ok' | 'danger'
  className?: string
  /** Hide the numeric percentage on the right. */
  hideValue?: boolean
  height?: number
}

export function Progress({ value, label, indeterminate, tone = 'accent', className, hideValue, height }: ProgressProps) {
  const unknown = indeterminate || value < 0 || Number.isNaN(value)
  const clamped = unknown ? 0 : Math.max(0, Math.min(1, value))
  const percent = Math.round(clamped * 100)
  return (
    <div
      className={clsx('rh-progress', `rh-progress--${tone}`, unknown && 'is-indeterminate', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={unknown ? undefined : percent}
      aria-label={typeof label === 'string' ? label : undefined}
    >
      {label || !hideValue ? (
        <div className="rh-progress__meta">
          <span className="rh-progress__label rh-truncate">{label}</span>
          {!hideValue && !unknown ? <span className="rh-progress__value rh-num">{percent}%</span> : null}
        </div>
      ) : null}
      <div className="rh-progress__track" style={height ? { height } : undefined}>
        <div className="rh-progress__bar" style={unknown ? undefined : { width: `${clamped * 100}%` }} />
      </div>
    </div>
  )
}

/** Alias kept so both names compile. */
export const ProgressBar = Progress
