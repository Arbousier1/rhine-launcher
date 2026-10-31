/**
 * Panel / PanelHeader: the single container primitive of the archive look.
 * One hairline border, a flat panel background and an optional caption row.
 */
import clsx from 'clsx'
import type { ComponentProps, ElementType, ReactNode } from 'react'

/**
 * Panel props.
 *
 * `ref` is intentionally excluded: the rendered element varies with `as`, so a
 * single ref type cannot be sound. Use a wrapper element when a ref is needed.
 */
export interface PanelProps extends Omit<ComponentProps<'section'>, 'title' | 'ref'> {
  /** English eyebrow above the title, rendered uppercase with wide tracking. */
  caption?: ReactNode
  title?: ReactNode
  /** Right hand side of the header row. */
  actions?: ReactNode
  /** Apply the standard inner padding. */
  padded?: boolean
  /** Render as a different element when the panel is not a landmark. */
  as?: 'section' | 'div' | 'article' | 'aside'
  /** Draw the panel with the accent rule on the left edge. */
  accent?: boolean
}

export function Panel({
  caption,
  title,
  actions,
  padded = true,
  as = 'section',
  accent = false,
  className,
  children,
  ...rest
}: PanelProps) {
  const Tag = as as ElementType
  const hasHeader = Boolean(caption || title || actions)
  return (
    <Tag
      {...rest}
      className={clsx('rh-panel', padded && 'rh-panel--padded', accent && 'rh-panel--accent', className)}
    >
      {hasHeader ? <PanelHeader caption={caption} title={title} actions={actions} /> : null}
      {children}
    </Tag>
  )
}

export interface PanelHeaderProps {
  caption?: ReactNode
  title?: ReactNode
  actions?: ReactNode
  className?: string
  /** Render a hairline underneath the header (default true). */
  rule?: boolean
}

export function PanelHeader({ caption, title, actions, className, rule = true }: PanelHeaderProps) {
  return (
    <div className={clsx('rh-panel__head', rule && 'rh-panel__head--rule', className)}>
      <div className="rh-panel__headtext">
        {caption ? <span className="rh-panel__caption rh-caption">{caption}</span> : null}
        {title ? <h2 className="rh-panel__title">{title}</h2> : null}
      </div>
      {actions ? <div className="rh-panel__actions">{actions}</div> : null}
    </div>
  )
}

/** Split a panel body into hairline-separated rows. */
export function PanelRows({ className, ...rest }: ComponentProps<'div'>) {
  return <div {...rest} className={clsx('rh-panel__rows', className)} />
}

export interface PanelRowProps extends ComponentProps<'div'> {
  label: ReactNode
  value?: ReactNode
  caption?: ReactNode
}

export function PanelRow({ label, value, caption, className, children, ...rest }: PanelRowProps) {
  return (
    <div {...rest} className={clsx('rh-panel__row', className)}>
      <div className="rh-panel__rowlabel">
        <span>{label}</span>
        {caption ? <span className="rh-caption rh-panel__rowcaption">{caption}</span> : null}
      </div>
      <div className="rh-panel__rowvalue">{value ?? children}</div>
    </div>
  )
}
