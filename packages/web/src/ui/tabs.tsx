/**
 * Controlled tab bar. `variant="line"` is the archive default: an underline
 * that slides to the active item in amber, everything else quiet ink.
 */
import clsx from 'clsx'
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface TabItem {
  key: string
  label: ReactNode
  caption?: ReactNode
  count?: number
  disabled?: boolean
}

export interface TabsProps {
  value: string
  onChange: (key: string) => void
  items: TabItem[]
  variant?: 'line' | 'solid'
  className?: string
  ariaLabel?: string
  /** Stretch items evenly across the available width. */
  block?: boolean
}

export function Tabs({ value, onChange, items, variant = 'line', className, ariaLabel, block }: TabsProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  const move = useCallback(
    (delta: number) => {
      const enabled = items.filter((item) => !item.disabled)
      if (enabled.length === 0) return
      const index = enabled.findIndex((item) => item.key === value)
      const next = enabled[(index + delta + enabled.length) % enabled.length]
      if (next) onChange(next.key)
    },
    [items, onChange, value],
  )

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        move(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        move(-1)
      }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [move])

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      className={clsx('rh-tabs', `rh-tabs--${variant}`, block && 'rh-tabs--block', className)}
    >
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${item.key}`}
            id={`tab-${item.key}`}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            className={clsx('rh-tabs__item', active && 'is-active', item.disabled && 'is-disabled')}
            onClick={() => onChange(item.key)}
          >
            <span className="rh-tabs__label">{item.label}</span>
            {typeof item.count === 'number' ? <span className="rh-tabs__count rh-num">{item.count}</span> : null}
            {item.caption ? <span className="rh-tabs__caption rh-caption">{item.caption}</span> : null}
            {active ? <span className="rh-tabs__marker" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
