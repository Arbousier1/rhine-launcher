import type {NativePanelContext} from '../native-panels'
export async function waitDelay(ms:number,signal:AbortSignal):Promise<void>{signal.throwIfAborted();return new Promise((resolve,reject)=>{const end=()=>{signal.removeEventListener('abort',abort);resolve()},timer=setTimeout(end,ms);const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason)};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})}
export function issue(error:unknown):string{return error instanceof Error?error.message:String(error)}
export function taskId(value:unknown):string{if(!value||typeof value!=='object'||typeof (value as {taskId?:unknown}).taskId!=='string')throw new Error('启动器没有返回有效任务 ID');return (value as {taskId:string}).taskId}
export async function waitNativeTask(ctx:NativePanelContext,id:string,progress:(task:any)=>void,signal=ctx.signal):Promise<any>{
 for(;;){signal.throwIfAborted();const task=await ctx.call<any>('launcher.tasks.get',{id},signal);if(!task||task.id!==id)throw new Error('任务响应与操作不符');progress(task);if(task.status==='succeeded')return task;if(task.status==='failed'||task.status==='cancelled')throw new Error(typeof task.error==='string'?task.error:task.error?.message??(task.status==='cancelled'?'任务已取消':'任务失败'));if(!['queued','running'].includes(task.status))throw new Error('未知任务状态');await waitDelay(700,signal)}
}
