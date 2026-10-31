/**
 * <ArchiveCoreLite /> — the CSS-only stand-in for the WebGL archive core.
 *
 * It is used while three.js loads, when WebGL is unavailable (remote desktop,
 * headless screenshots, locked-down browsers) and for reduce-motion users. The
 * silhouette, amber light guide and frosted cover are the same; only the
 * illumination is faked with layered gradients and hairlines.
 */
import clsx from 'clsx'

export interface ArchiveCoreLiteProps {
  className?: string
  lifted?: boolean
}

export function ArchiveCoreLite({ className, lifted = false }: ArchiveCoreLiteProps) {
  return (
    <div className={clsx('rh-core-lite', lifted && 'is-lifted', className)} aria-hidden="true">
      <div className="rh-core-lite__stage">
        <span className="rh-core-lite__shadow" />
        <div className="rh-core-lite__base">
          <span className="rh-core-lite__plate" />
          <span className="rh-core-lite__edge rh-core-lite__edge--front" />
          <span className="rh-core-lite__edge rh-core-lite__edge--side" />
          <span className="rh-core-lite__screw rh-core-lite__screw--tl" />
          <span className="rh-core-lite__screw rh-core-lite__screw--tr" />
          <span className="rh-core-lite__screw rh-core-lite__screw--bl" />
          <span className="rh-core-lite__screw rh-core-lite__screw--br" />

          <div className="rh-core-lite__cover">
            <span className="rh-core-lite__band" />
            <span className="rh-core-lite__puck" />
            <span className="rh-core-lite__ring" />
            <span className="rh-core-lite__ring rh-core-lite__ring--inner" />
            <span className="rh-core-lite__etch rh-core-lite__etch--a" />
            <span className="rh-core-lite__etch rh-core-lite__etch--b" />
            <span className="rh-core-lite__etch rh-core-lite__etch--c" />
            <span className="rh-core-lite__sheen" />
          </div>
        </div>
      </div>
    </div>
  )
}
