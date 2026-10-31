/**
 * Page header: Chinese title, English eyebrow above it, a hairline underneath
 * and the primary action pinned to the right — the "ACCESS FILE" pattern.
 *
 * The title and eyebrow decrypt on first paint through the `motion.text-decrypt`
 * slot. The header itself is a dumb atom: with the motion disabled it renders
 * the plain label, with it enabled the plugin takes over. Server rendering
 * always sees the converged text.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { PluginSlot } from '@/plugins/slots.tsx'

export interface PageHeaderProps {
  title: ReactNode
  caption?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Extra content rendered under the rule (filters, summary lines…). */
  toolbar?: ReactNode
  className?: string
}

export function PageHeader({ title, caption, description, actions, toolbar, className }: PageHeaderProps) {
  return (
    <header className={clsx('rh-pagehead-stack', className)}>
      <div className="rh-pagehead">
        <div className="rh-pagehead__text">
          {caption ? (
            <span className="rh-caption rh-pagehead__caption">
              {typeof caption === 'string' ? (
                <PluginSlot
                  name="motion.text-decrypt"
                  props={{ text: caption, duration: 260 }}
                  fallback={caption}
                />
              ) : (
                caption
              )}
            </span>
          ) : null}
          <h1 className="rh-pagehead__title">
            {typeof title === 'string' ? (
              <PluginSlot
                name="motion.text-decrypt"
                props={{ text: title, duration: 360 }}
                fallback={title}
              />
            ) : (
              title
            )}
          </h1>
          {description ? <p className="rh-pagehead__sub">{description}</p> : null}
        </div>
        {actions ? <div className="rh-pagehead__actions">{actions}</div> : null}
      </div>
      {toolbar ? <div className="rh-toolbar">{toolbar}</div> : null}
    </header>
  )
}
