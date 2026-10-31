/**
 * Launch sequence state machine.
 *
 * Extracted from the overlay component so the progression rules are testable
 * without a DOM: stages advance monotonically, a failure pins the stage that
 * failed, and completion always reports 100%.
 */

export type LaunchStage = 'prepare' | 'verify' | 'java' | 'spawn' | 'running'

export const LAUNCH_STAGES: LaunchStage[] = ['prepare', 'verify', 'java', 'spawn', 'running']

export type LaunchPhase = 'running' | 'done' | 'failed'

/** Index of a stage in the canonical order; unknown stages fall back to 0. */
export function stageIndex(stage: LaunchStage): number {
  const index = LAUNCH_STAGES.indexOf(stage)
  return index < 0 ? 0 : index
}

/** Fraction of the stage list that has completed, used for the progress line. */
export function stageFraction(stage: LaunchStage, phase: LaunchPhase): number {
  const index = stageIndex(stage)
  const done = phase === 'done' ? LAUNCH_STAGES.length : index
  return Math.min(1, Math.max(0, done / LAUNCH_STAGES.length))
}

/** Resolve the visual state of one stage row. */
export function stageState(
  item: LaunchStage,
  active: LaunchStage,
  phase: LaunchPhase,
): 'idle' | 'active' | 'done' | 'failed' {
  const index = LAUNCH_STAGES.indexOf(item)
  const activeIndex = stageIndex(active)
  if (phase === 'failed' && index === activeIndex) return 'failed'
  if (phase === 'done' || index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'idle'
}

/** Overall progress in 0..1, preferring a real value when the caller has one. */
export function overallProgress(
  progress: number | undefined,
  stage: LaunchStage,
  phase: LaunchPhase,
): number {
  if (typeof progress === 'number' && progress >= 0) return Math.min(1, progress)
  return stageFraction(stage, phase)
}
