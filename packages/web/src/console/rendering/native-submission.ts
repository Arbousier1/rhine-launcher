/** One native queue submission in flight; completion never blocks the UI thread. */
export class NativeSubmissionGate{
 private pending=false;private disposed=false;private generation=0
 submittedFrames=0;deferredFrames=0
 constructor(private queue:Pick<GPUQueue,'onSubmittedWorkDone'>,private lost:(error:unknown)=>void){}
 ready(){if(this.disposed)return false;if(this.pending){this.deferredFrames++;return false}return true}
 submitted(){if(this.disposed)return;this.submittedFrames++;this.pending=true;const generation=++this.generation;this.queue.onSubmittedWorkDone().then(()=>{if(!this.disposed&&generation===this.generation)this.pending=false},error=>{if(!this.disposed&&generation===this.generation){this.pending=false;this.lost(error)}})}
 reset(){this.generation++;this.pending=false}
 dispose(){this.disposed=true;this.generation++;this.pending=false}
}
export async function waitNativeQueue(queue:Pick<GPUQueue,'onSubmittedWorkDone'>,signal:AbortSignal):Promise<void>{signal.throwIfAborted();await new Promise<void>((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason)};signal.addEventListener('abort',abort,{once:true});queue.onSubmittedWorkDone().then(()=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(signal.reason);else resolve()},error=>{signal.removeEventListener('abort',abort);reject(error)});if(signal.aborted)abort()})}
