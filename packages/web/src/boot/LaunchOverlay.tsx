/**
 * Launch overlay.
 *
 * Driven by the pure state machine in ./launch-stages.ts so the animation is
 * honest: stages advance only when the caller reports progress, and a launch
 * failure pins the failing stage in red instead of silently closing.
 */
import { useEffect, useState } from 'react'
import { Button, Spinner } from '@/ui'
import type { Translator } from '@/app/i18n'
import { LAUNCH_STAGES, overallProgress, stageState } from './launch-stages.ts'
import type { LaunchPhase, LaunchStage } from './launch-stages.ts'

export type { LaunchPhase, LaunchStage } from './launch-stages.ts'
export { LAUNCH_STAGES, stageFraction, stageIndex, stageState } from './launch-stages.ts'

export interface LaunchOverlayProps {
  open: boolean
  t: Translator
  instanceName: string
  gameVersion: string
  stage: LaunchStage
  phase: LaunchPhase
  /** 0..1, negative while the total is unknown. */
  progress?: number
  error?: string | null
  onDismiss: () => void
}

export function LaunchOverlay({
  open,
  t,
  instanceName,
  gameVersion,
  stage,
  phase,
  progress,
  error,
  onDismiss,
}: LaunchOverlayProps) {
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  if (!mounted) return null

  const fraction = overallProgress(progress, stage, phase)
  const indeterminate = typeof progress === 'number' && progress < 0

  return (
    <div className="rh-launch" role="dialog" aria-modal="true" aria-label={t('instance.action.launch')}>
      <div className="rh-launch__inner">
        <div className="rh-launch__head">
          <div className="rh-launch__titles">
            <span className="rh-caption rh-launch__caption">LAUNCH SEQUENCE</span>
            <span className="rh-launch__name">{instanceName}</span>
            <span className="rh-caption">MINECRAFT {gameVersion}</span>
          </div>
          {phase === 'running' ? <Spinner size="md" /> : null}
        </div>

        <ol className="rh-launch__stages">
          {LAUNCH_STAGES.map((item, index) => {
            const state = stageState(item, stage, phase)
            return (
              <li key={item} className={'rh-launch__stage is-' + state}>
                <span className="rh-launch__index">{String(index + 1).padStart(2, '0')}</span>
                <span className="rh-launch__stagename">{t('launch.stage.' + item)}</span>
                <span className="rh-launch__tick">
                  {state === 'done' ? (
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden="true">
                      <path d="M1 5.2L4.2 8.4L11 1" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  ) : state === 'active' ? (
                    <Spinner size="sm" />
                  ) : state === 'failed' ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" />
                    </svg>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="rh-launch__bar">
          <div
            className={'rh-launch__fill' + (indeterminate ? ' is-indeterminate' : '')}
            style={indeterminate ? undefined : { width: Math.round(fraction * 100) + '%' }}
          />
        </div>

        <div className="rh-launch__foot">
          <span className="rh-launch__hint">{t('launch.hint')}</span>
          {phase === 'failed' || phase === 'done' ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t('launch.dismiss')}
            </Button>
          ) : (
            <span className="rh-caption">{Math.round(fraction * 100)}%</span>
          )}
        </div>

        {error ? <pre className="rh-launch__error">{error}</pre> : null}
      </div>
    </div>
  )
}
