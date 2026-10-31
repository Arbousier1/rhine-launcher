import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId} from '../catalog-http'
/** Wait on the existing task endpoint; works even when optional realtime is disabled. */
export default defineFeature<{id:string},Promise<any>>({
 id:'launcher.task.wait',capability:'launcher.task.wait',title:'等待真实安装任务',
 async execute(input,env){
  const path='/api/tasks/'+inputId(input.id)
  for(;;){
   env.signal.throwIfAborted()
   const task=await catalogRequest<{status:string}>(env,path)
   if(['succeeded','failed','cancelled'].includes(task?.status))return task
   if(!['queued','running'].includes(task?.status))throw new Error('启动器返回了未知任务状态')
   await new Promise<void>((resolve,reject)=>{
    const finish=()=>{env.signal.removeEventListener('abort',abort);resolve()}
    const timer=setTimeout(finish,600)
    const abort=()=>{env.signal.removeEventListener('abort',abort);clearTimeout(timer);reject(env.signal.reason)}
    env.signal.addEventListener('abort',abort,{once:true})
    if(env.signal.aborted)abort()
   })
  }
 }
})
