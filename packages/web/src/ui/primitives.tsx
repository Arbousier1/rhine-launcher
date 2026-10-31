/**
 * Primitive building blocks of the Rhine design system: buttons, badges,
 * indicators and the small text shims. All of them render a single DOM node,
 * accept `className` and forward every remaining native prop.
 */
import clsx from 'clsx'
import type { ComponentProps, ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/* Spinner                                                             */
/* ------------------------------------------------------------------ */

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  className?: string
}

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const px = size === 'sm' ? 12 : size === 'lg' ? 20 : 16
  return (
    <span
      className={clsx('rh-spinner', `rh-spinner--${size}`, className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.22" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        />
      </svg>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'quiet'
export type ControlSize = 'sm' | 'md'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ControlSize
  /** Stretch to the container width. */
  block?: boolean
  /** Show a spinner and ignore clicks while keeping the width stable. */
  loading?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}

export function Button({
  variant = 'ghost',
  size = 'md',
  block = false,
  loading = false,
  leading,
  trailing,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'rh-btn',
        `rh-btn--${variant}`,
        `rh-btn--${size}`,
        block && 'rh-btn--block',
        loading && 'is-loading',
        className,
      )}
    >
      {leading ? <span className="rh-btn__slot">{leading}</span> : null}
      <span className="rh-btn__label">{children}</span>
      {loading ? (
        <Spinner size="sm" className="rh-btn__spin" />
      ) : trailing ? (
        <span className="rh-btn__slot">{trailing}</span>
      ) : null}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export interface IconButtonProps extends ComponentProps<'button'> {
  /** Accessible name; also rendered as the native title attribute. */
  label: string
  variant?: 'ghost' | 'plain' | 'danger'
  size?: ControlSize
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  type = 'button',
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      title={title ?? label}
      aria-label={label}
      className={clsx('rh-iconbtn', `rh-iconbtn--${variant}`, `rh-iconbtn--${size}`, className)}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export type Tone = 'accent' | 'muted' | 'danger' | 'ok' | 'warn'

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: Tone
  mono?: boolean
  /** Rendered as a filled pill instead of an outlined tag. */
  solid?: boolean
}

export function Badge({ tone = 'muted', mono = false, solid = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={clsx('rh-badge', `rh-badge--${tone}`, mono && 'rh-badge--mono', solid && 'rh-badge--solid', className)}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* StatusDot                                                           */
/* ------------------------------------------------------------------ */

export interface StatusDotProps {
  tone?: Tone
  /** Pulse forever, used for "running" indicators. */
  pulse?: boolean
  className?: string
  label?: string
}

export function StatusDot({ tone = 'muted', pulse = false, className, label }: StatusDotProps) {
  return (
    <span
      className={clsx('rh-dot', `rh-dot--${tone}`, pulse && 'rh-dot--pulse', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}

/* ------------------------------------------------------------------ */
/* KeyCap / Divider / Skeleton                                         */
/* ------------------------------------------------------------------ */

export function KeyCap({ children, className, ...rest }: ComponentProps<'kbd'>) {
  return (
    <kbd {...rest} className={clsx('rh-keycap', className)}>
      {children}
    </kbd>
  )
}

export function Divider({ className, ...rest }: ComponentProps<'hr'>) {
  return <hr {...rest} className={clsx('rh-divider', className)} />
}

export interface SkeletonProps extends ComponentProps<'div'> {
  width?: number | string
  height?: number | string
  /** Number of stacked lines. */
  lines?: number
}

export function Skeleton({ width, height, lines, className, style, ...rest }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <span className={clsx('rh-skeleton-stack', className)}>
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className="rh-skeleton"
            style={{ width: index === lines - 1 ? '62%' : width ?? '100%', height: height ?? 12, ...style }}
          />
        ))}
      </span>
    )
  }
  return (
    <div
      {...rest}
      className={clsx('rh-skeleton', className)}
      style={{ width: width ?? '100%', height: height ?? 12, ...style }}
      aria-hidden="true"
    />
  )
}
