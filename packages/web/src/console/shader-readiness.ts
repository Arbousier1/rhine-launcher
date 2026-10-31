/** Three 0.183's compileAsync readiness check with owned polling and cancellation. */
export interface PreparedProgram{isReady():boolean;getUniforms():unknown;diagnostics?:{runnable?:boolean}}
export async function waitForShaderPrograms(programs:readonly PreparedProgram[],signal:AbortSignal,timeoutMs=30000):Promise<void>{
 signal.throwIfAborted();const deadline=Date.now()+timeoutMs
 while(programs.some(program=>!program.isReady())){
  signal.throwIfAborted();if(Date.now()>=deadline)throw new Error('三维着色器准备超时，请重新连接')
  await new Promise<void>((resolve,reject)=>{const finish=()=>{signal.removeEventListener('abort',abort);resolve()},timer=setTimeout(finish,10);const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason)};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})
 }
 signal.throwIfAborted()
 // Populate the same uniform/attribute caches that first interactive rendering would initialize.
 for(const program of programs){signal.throwIfAborted();program.getUniforms();if(program.diagnostics?.runnable===false)throw new Error('三维着色器编译失败，请检查图形驱动')}
}
