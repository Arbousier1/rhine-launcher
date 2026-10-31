/**
 * Page header wrapper.
 *
 * Mirrors the design system's `rh-pagehead*` markup until `PageHeader` is
 * exported from '@/ui'; using the same class names means switching over is a
 * one-line import change with no visual difference.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'

export interface PageHeadProps {
  title: ReactNode
  /** English eyebrow above the title, rendered uppercase. */
  caption?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Filter row rendered under the hairline. */
  toolbar?: ReactNode
  className?: string
}

export function PageHead({ title, caption, description, actions, toolbar, className }: PageHeadProps) {
  return (
    <header className={clsx('rh-pagehead-stack', className)}>
      <div className="rh-pagehead">
        <div className="rh-pagehead__text">
          {caption ? <span className="rh-caption rh-pagehead__caption">{caption}</span> : null}
          <h1 className="rh-pagehead__title">{title}</h1>
          {description ? <p className="rh-pagehead__sub">{description}</p> : null}
        </div>
        {actions ? <div className="rh-pagehead__actions">{actions}</div> : null}
      </div>
      {toolbar ? <div className="rh-toolbar">{toolbar}</div> : null}
    </header>
  )
}
