import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { FeatureError,type FeatureEnvironment } from '@rhine/plugin-api'
import type { RhPaths } from '../contracts.ts'
import type { LaunchSession,LogLine,Settings,ServerEvent } from '../types.ts'
import { redactCommand,type PreparedFeatureLaunch } from './feature-plan.ts'
import { sessionState,sessionList,terminateProcess } from './session-state.ts'
import { classifyLine,quoteArg } from '../services/launch.ts'

/** Execute a prepared argv directly. Never execute user JVM arguments through a shell. */
export async function spawnGame(plan:PreparedFeatureLaunch,env:FeatureEnvironment):Promise<LaunchSession>{
 env.signal.throwIfAborted()
 const state=sessionState(env)
 if(/\.(cmd|bat|ps1)$/i.test(plan.command[0]))throw new FeatureError('INVALID_JAVA_EXECUTABLE','Java 必须为实际可执行文件，不能是批处理或 PowerShell 脚本',400)
 const id='session-'+randomUUID(), directory=join(plan.instance.path,'.rhine','logs')
 await mkdir(directory,{recursive:true})
 const settings=env.use<Settings>('settings.resolve')
 const keep=settings.keepLogs
 if(keep>0){const files=(await readdir(directory)).filter(name=>name.endsWith('.log')).sort();for(const old of files.slice(0,Math.max(0,files.length-keep+1)))await unlink(join(directory,old))}
 const secrets=[plan.account.accessToken??'',plan.account.refreshToken??'',plan.account.clientToken??''].filter(value=>value&&value!=='0')
 const scrub=(text:string)=>secrets.reduce((out,secret)=>out.split(secret).join('<redacted>'),text)
 const session:LaunchSession={id,instanceId:plan.instance.id,accountName:plan.account.name,startedAt:Date.now(),status:'starting',command:redactCommand(plan.command,secrets),logFile:join(directory,Date.now()+'-'+id+'.log')}
 const output=createWriteStream(session.logFile,{flags:'wx'})
 await new Promise<void>((resolve,reject)=>{output.once('open',()=>resolve());output.once('error',reject)})
 state.sessions.set(id,session);state.logs.set(id,[])
 const emit=(event:ServerEvent)=>{try{env.use('events.emit',event)}catch(error){if(!(error instanceof FeatureError)||!['PLUGIN_CANCELLED','PLUGIN_UNAVAILABLE'].includes(error.code))throw error}}
 const append=(message:string,level:LogLine['level']='info')=>{
  const line:LogLine={time:Date.now(),level,message:scrub(message)}
  const lines=state.logs.get(id)??[];lines.push(line);if(lines.length>4000)lines.splice(0,lines.length-4000);state.logs.set(id,lines)
  if(!output.destroyed)output.write(line.message+'\n')
  emit({type:'launch-log',sessionId:id,lines:[line]})
 }
 const persist=async()=>{
  const paths=env.use<RhPaths>('paths.get')
  await env.use<Promise<void>>('storage.write',{file:join(paths.root,'launch-sessions.json'),value:sessionList(env).slice(0,50)})
 }
 append('# '+new Date().toISOString()+' '+plan.instance.name)
 append('# '+session.command.map(quoteArg).join(' '))
 env.signal.throwIfAborted()
 let child:ReturnType<typeof spawn>
 try{child=spawn(plan.command[0],plan.command.slice(1),{cwd:plan.cwd,detached:plan.request.detach!==false,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false,env:{...process.env}})}catch(error){output.end();state.sessions.delete(id);throw error}
 let resolveClosed!:()=>void
 const closed=new Promise<void>(resolve=>{resolveClosed=resolve})
 let spawnError:Error|undefined
 let stopping:Promise<void>|undefined
 const stop=()=>{if(!state.processes.has(id))return closed;return stopping??=(async()=>{session.status='stopped';await terminateProcess(child);await closed})()}
 state.processes.set(id,{child,closed,stop})
 env.onDispose(stop)
 const abort=()=>{void stop().catch(()=>{})}
 env.signal.addEventListener('abort',abort,{once:true})
 const feed=(stream:NodeJS.ReadableStream|null,defaultLevel:LogLine['level'])=>{
  if(!stream)return
  let pending='';stream.setEncoding?.('utf8')
  stream.on('data',(chunk:string)=>{
   pending+=chunk
   const lines=pending.split(/\r?\n/);pending=lines.pop()??''
   for(const line of lines)append(line,classifyLine(line,defaultLevel))
   if(pending.length>256*1024){append(pending.slice(0,256*1024)+' [截断]',defaultLevel);pending=''}
  })
  stream.on('end',()=>{if(pending)append(pending,defaultLevel)})
 }
 feed(child.stdout,'info');feed(child.stderr,'warn')
 output.on('error',()=>{void stop().catch(()=>{})})
 child.once('error',error=>{spawnError=error;append('无法启动游戏：'+error.message,'error')})
 child.once('close',(code,signal)=>{
  void (async()=>{
   try{
    const status=session.status==='stopped'?'stopped':code===0?'exited':'crashed'
    append('进程退出，退出码 '+String(code)+(signal?'，信号 '+signal:''))
    await new Promise<void>(resolve=>output.end(()=>resolve()))
    session.status=status;session.exitCode=code??undefined;session.endedAt=Date.now()
    state.processes.delete(id)
    env.signal.removeEventListener('abort',abort)
    try{await persist();await env.use<Promise<void>>('instance.add-playtime',{id:plan.instance.id,elapsedMs:session.endedAt-session.startedAt})}catch(error){if(!env.signal.aborted)env.context.logger('launch').warn('保存会话失败：%s',String(error))}
    emit({type:'launch',session:{...session}});emit({type:'launch-exit',sessionId:id,exitCode:code,status})
   }finally{resolveClosed()}
  })().catch(error=>env.context.logger('launch').error('进程收尾失败：%s',String(error)))
 })
 try{
  await new Promise<void>((resolve,reject)=>{child.once('spawn',()=>resolve());child.once('error',reject)})
  env.signal.throwIfAborted()
  if(spawnError)throw spawnError
  session.pid=child.pid;session.status='running'
  await env.use<Promise<unknown>>('instance.mark-launched',{id:plan.instance.id})
  await persist()
  emit({type:'launch',session:{...session}})
  return {...session}
 }catch(error){await stop();throw error}
}
