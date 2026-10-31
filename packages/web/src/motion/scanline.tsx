/**
 * <ScanLine /> — a 1px band of warm light that crosses a surface every six
 * seconds. Slow, low contrast, never a "cyberpunk" streak: it is the archival
 * scanner passing over the page.
 */
import clsx from 'clsx'

export interface ScanLineProps {
  /** `sweep` crosses top→bottom, `edge` hugs a panel border. */
  variant?: 'sweep' | 'edge'
  className?: string
  /** Seconds per pass. */
  period?: number
}

export function ScanLine({ variant = 'sweep', className, period = 6 }: ScanLineProps) {
  return (
    <span
      className={clsx('rh-scanline', 'rh-scanline--' + variant, className)}
      style={{ animationDuration: period + 's' }}
      aria-hidden="true"
    />
  )
}
