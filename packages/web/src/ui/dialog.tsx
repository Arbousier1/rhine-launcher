/**
 * Modal dialog with a focus trap, Escape handling and a hairline frame.
 * Rendered into a portal so page layout never shifts.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './primitives.tsx'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  caption?: ReactNode
  footer?: ReactNode
  width?: number | string
  closeOnBackdrop?: boolean
  /** Hide the close button in the header. */
  hideClose?: boolean
  className?: string
  children?: ReactNode
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  onClose,
  title,
  caption,
  footer,
  width = 520,
  closeOnBackdrop = true,
  hideClose = false,
  className,
  children,
}: DialogProps) {
  const surface = useRef<HTMLDivElement | null>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const titleId = useId().replace(/:/g, '')

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    const node = surface.current
    const first = node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusable.length === 0) {
        event.preventDefault()
        node.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus?.()
    }
  }, [open, onClose])

  const onBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      if (closeOnBackdrop) onClose()
    },
    [closeOnBackdrop, onClose],
  )

  // Portals require a DOM: bail out during a server pass instead of throwing.
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="rh-dialog-backdrop" onMouseDown={onBackdrop} role="presentation">
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? `dlg-${titleId}` : undefined}
        tabIndex={-1}
        className={clsx('rh-dialog', className)}
        style={{ width: typeof width === 'number' ? `min(${width}px, calc(100vw - 48px))` : width }}
      >
        {title || caption || !hideClose ? (
          <header className="rh-dialog__head">
            <div className="rh-dialog__headtext">
              {caption ? <span className="rh-caption">{caption}</span> : null}
              {title ? (
                <h2 id={`dlg-${titleId}`} className="rh-dialog__title">
                  {title}
                </h2>
              ) : null}
            </div>
            {hideClose ? null : <IconButton label="关闭" variant="plain" onClick={onClose}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </IconButton>}
          </header>
        ) : null}
        <div className="rh-dialog__body">{children}</div>
        {footer ? <footer className="rh-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
