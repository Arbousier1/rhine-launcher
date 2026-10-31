import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { FeatureError } from '@rhine/plugin-api'
import { join } from 'node:path'
import type { LaunchSession,LogLine } from '../types.ts'
import type { RhPaths } from '../contracts.ts'

export interface RunningProcess { child:ChildProcess; closed:Promise<void>; stop:()=>Promise<void> }
export interface SessionState { sessions:Map<string,LaunchSession>; logs:Map<string,LogLine[]>; processes:Map<string,RunningProcess>; loaded:boolean }
export function sessionState(env:FeatureEnvironment):SessionState {
 const state=env.state<SessionState>('session.state',()=>({sessions:new Map(),logs:new Map(),processes:new Map(),loaded:false}),async state=>{await Promise.allSettled([...state.processes.values()].map(item=>item.stop()))})
 if(!state.loaded){
  const paths=env.use<RhPaths>('paths.get')
  const stored=env.use<LaunchSession[]>('storage.read.sync',{file:join(paths.root,'launch-sessions.json'),fallback:[]})
  for(const entry of Array.isArray(stored)?stored:[]){if(!entry?.id)continue;state.sessions.set(entry.id,{...entry,status:entry.status==='running'||entry.status==='starting'?'stopped':entry.status})}
  state.loaded=true
 }
 return state
}
export function sessionList(env:FeatureEnvironment):LaunchSession[]{return [...sessionState(env).sessions.values()].sort((a,b)=>b.startedAt-a.startedAt).map(entry=>({...entry,command:[...entry.command]}))}
export async function terminateProcess(child:ChildProcess):Promise<void>{
 if(child.exitCode!==null||child.signalCode)return
 if(process.platform==='win32'&&child.pid){
  await new Promise<void>((resolve,reject)=>{
   const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,shell:false})
   const timer=setTimeout(()=>{killer.kill();child.kill();resolve()},5000)
   killer.once('error',error=>{clearTimeout(timer);try{child.kill();resolve()}catch{reject(error)}})
   killer.once('close',()=>{clearTimeout(timer);resolve()})
  })
 }else{child.kill('SIGTERM');const timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL')},3000);timer.unref();child.once('close',()=>clearTimeout(timer))}
}
export async function stopSession(env:FeatureEnvironment,id:string):Promise<void>{
 const state=sessionState(env),session=state.sessions.get(id),process=state.processes.get(id)
 if(!session||!process)throw new FeatureError('SESSION_NOT_RUNNING','会话不存在或已经结束：'+id,404)
 session.status='stopped'
 await process.stop()
}
