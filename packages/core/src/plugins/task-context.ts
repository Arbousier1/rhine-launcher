import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { TaskHandle } from '../contracts.ts'
/** Pass both a parent task cancellation and this feature's lifetime to IO. */
export function taskContext(env:FeatureEnvironment, provided?:TaskHandle):TaskHandle {
  const parent=provided ?? env.task
  const signal=parent && 'signal' in parent && parent.signal ? AbortSignal.any([env.signal,parent.signal as AbortSignal]) : env.signal
  return {
    id: parent?.id ?? 'feature-operation', signal,
    get cancelled(){return signal.aborted || Boolean(parent?.cancelled)},
    throwIfCancelled(){parent?.throwIfCancelled();signal.throwIfAborted()},
    setProgress(progress){parent?.setProgress(progress)},
    log(message,level){if(parent)parent.log(message,level);else env.context.logger('feature').info(message)},
  }
}
