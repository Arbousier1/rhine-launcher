/** Await actual GPU completion during loading, without blocking input or leaving polling behind. */
export async function waitForGpuPreparation(gl:WebGL2RenderingContext,signal:AbortSignal,timeoutMs=30000):Promise<void>{
 signal.throwIfAborted();if(typeof gl.fenceSync!=='function')return
 const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!fence)return;gl.flush();const deadline=Date.now()+timeoutMs
 try{for(;;){signal.throwIfAborted();if(gl.isContextLost())throw new Error('三维资源准备时图形上下文丢失');const status=gl.clientWaitSync(fence,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return;if(status===gl.WAIT_FAILED)throw new Error('三维资源准备未能完成');if(Date.now()>=deadline)throw new Error('三维资源准备超时，请重新连接');await new Promise<void>((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',abort);resolve()},timer=setTimeout(done,4);const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason)};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})}}
 finally{gl.deleteSync(fence)}
}
export async function prepareWithRestoration(steps:readonly (()=>void|Promise<void>)[],restore:()=>void,signal:AbortSignal):Promise<void>{try{for(const step of steps){signal.throwIfAborted();await step()}signal.throwIfAborted()}finally{restore()}}
