/**
 * Small building blocks shared by the feature pages: chips, stat strips,
 * notices and the deliberate "copy to clipboard" button.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { IconButton, StatusDot, Tooltip } from '@/ui'
import { copyText } from '@/features/accounts/accounts.ts'
import styles from './page.module.css'

/* ------------------------------------------------------------------ */
/* Chip / segmented control                                            */
/* ------------------------------------------------------------------ */

export interface ChipProps {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  title?: string
  disabled?: boolean
  count?: number
}

/** A hairline pill used for filters; the active one inverts to ink. */
export function Chip({ active = false, onClick, children, title, disabled, count }: ChipProps) {
  if (!onClick) {
    return (
      <span className={clsx(styles.segmented__item, active && styles['is-active'])} title={title}>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={clsx(styles.segmented__item, active && 'is-active', active && styles['is-active'])}
      onClick={onClick}
    >
      {children}
      {typeof count === 'number' ? <span className={styles.row__num}> {count}</span> : null}
    </button>
  )
}

export interface ChipGroupProps {
  label?: ReactNode
  children: ReactNode
  className?: string
}

/** Labelled cluster of chips. */
export function ChipGroup({ label, children, className }: ChipGroupProps) {
  return (
    <div className={clsx(styles.toolbarGroup, className)}>
      {label ? <span className={styles.toolbarLabel}>{label}</span> : null}
      <span className={styles.segmented}>{children}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stat strip                                                          */
/* ------------------------------------------------------------------ */

export interface StatItem {
  caption?: ReactNode
  value: ReactNode
  hint?: ReactNode
}

/** The hairline counter strip under the page header. */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className={styles.stats}>
      {items.map((item, index) => (
        <div className={styles.stat} key={index}>
          {item.caption ? <span className={styles.stat__caption}>{item.caption}</span> : null}
          <span className={styles.stat__value}>{item.value}</span>
          {item.hint ? <span className={styles.stat__hint}>{item.hint}</span> : null}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Notice                                                              */
/* ------------------------------------------------------------------ */

export interface NoticeProps {
  level?: 'info' | 'warn' | 'danger' | 'ok'
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}

/** Inline hairline notice; the left rule carries the severity colour. */
export function Notice({ level = 'info', title, children, actions }: NoticeProps) {
  const tone = level === 'info' ? undefined : styles['notice--' + level]
  return (
    <div className={clsx(styles.notice, tone)} role={level === 'danger' ? 'alert' : 'status'}>
      <StatusDot tone={level === 'info' ? 'muted' : level === 'danger' ? 'danger' : level === 'ok' ? 'ok' : 'warn'} />
      <div className={styles.notice__body}>
        {title ? <span className={styles.notice__title}>{title}</span> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {actions ? <div className={styles.notice__actions}>{actions}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* CopyButton                                                          */
/* ------------------------------------------------------------------ */

export interface CopyButtonProps {
  value: string
  label?: string
  onCopied?: () => void
  onFailed?: () => void
}

/** Icon button that copies a value through the shared clipboard helper. */
export function CopyButton({ value, label = '复制', onCopied, onFailed }: CopyButtonProps) {
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        variant="plain"
        size="sm"
        onClick={async () => {
          const ok = await copyText(value)
          if (ok) onCopied?.()
          else onFailed?.()
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" stroke="currentColor" strokeWidth="1" />
          <path d="M10.5 5.5v-3h-8v8h3" stroke="currentColor" strokeWidth="1" />
        </svg>
      </IconButton>
    </Tooltip>
  )
}

/* ------------------------------------------------------------------ */
/* Tile                                                                */
/* ------------------------------------------------------------------ */

export interface TileProps {
  src?: string
  label?: ReactNode
  round?: boolean
  size?: 'md' | 'lg'
  alt?: string
}

/** Square image tile with a monogram fallback. */
export function Tile({ src, label, round, size = 'md', alt }: TileProps) {
  return (
    <span
      className={clsx(styles.tile, round && styles['tile--round'], size === 'lg' && styles['tile--lg'])}
      aria-hidden={alt ? undefined : true}
    >
      {src ? <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" /> : label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Placeholder                                                         */
/* ------------------------------------------------------------------ */

/** Inline "nothing here yet" text used inside panels. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <p className={styles.placeholder}>{children}</p>
}
