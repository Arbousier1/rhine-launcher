import {catalogCall,getVersions,getLoaderVersions} from '../catalog-api'
import {createInstance,type LauncherInstanceConfig} from '../launcher-bridge'
export {getVersions,getLoaderVersions}
/** Install through the real version/loader capabilities and return the task id only. */
export async function installVersion(gameVersion:string,loader:string,loaderVersion:string,signal?:AbortSignal):Promise<string>{
 const task=loader==='vanilla'
  ?await catalogCall<{taskId:string}>('launcher.version.install',{gameVersion},signal)
  :await catalogCall<{taskId:string}>('launcher.loader.install',{gameVersion,loaderVersion,kind:loader},signal)
 if(!task||typeof task.taskId!=='string'||!task.taskId)throw new Error('启动器没有返回安装任务')
 return task.taskId
}
/** Poll the real task endpoint; status is never invented locally. */
export async function waitForTask(id:string,signal:AbortSignal,progress:(text:string)=>void):Promise<void>{
 for(;;){signal.throwIfAborted();const task=await catalogCall<{status:string;error?:{message?:string}|string;progress?:{message?:string}}>('launcher.task.wait',{id},signal)
  if(task.progress?.message)progress(task.progress.message)
  if(task.status==='succeeded')return
  if(task.status==='failed'||task.status==='cancelled')throw new Error(typeof task.error==='string'?task.error:task.error?.message??(task.status==='cancelled'?'安装已取消':'安装失败'))
 }
}
export function newInstance(config:LauncherInstanceConfig):Promise<{id:string}>{return createInstance(config) as Promise<{id:string}>}
