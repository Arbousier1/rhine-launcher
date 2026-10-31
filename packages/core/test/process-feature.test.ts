import {describe,it,expect,afterEach,vi} from 'vitest'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLauncherContext} from '../src/plugins/boot.ts'
import type {RhContext} from '../src/contracts.ts'
import type {LaunchSession,ServerEvent} from '../src/types.ts'
const hosts:{root:string;ctx:RhContext}[]=[]
afterEach(async()=>{for(const {root,ctx}of hosts.splice(0)){await ctx.features.dispose();await rm(root,{recursive:true,force:true})}})
async function host(script:string){
 const root=await mkdtemp(join(tmpdir(),'rhine-process-')),ctx=await createLauncherContext({root});hosts.push({root,ctx})
 const account=await ctx.accounts.addOffline('ProcessTest')
 const instance=await ctx.instances.create({name:'Process fixture',gameVersion:'1.20.1',loaders:[],memory:{minMb:512,maxMb:2048},jvmArgs:[],gameArgs:[],window:{width:854,height:480,fullscreen:false}})
 const plan={instance,account:{...account,accessToken:'private-game-token'},version:{id:'fixture',libraries:[]},request:{instanceId:instance.id,accountId:account.id},cwd:instance.path,mainClass:'fixture',command:[process.execPath,'-e',script]}
 return {ctx,plan,root}
}

describe('actual shell-free process feature',()=>{
 it('captures the real child stdout/stderr, redacts credentials and persists its exit',async()=>{
  const {ctx,plan}=await host("console.log('real stdout private-game-token');console.error('real stderr');setTimeout(()=>process.exit(0),50)")
  const events:ServerEvent[]=[];const unsubscribe=ctx.bus.subscribe(event=>events.push(event))
  const started=await ctx.features.call<Promise<LaunchSession>>('launch.spawn',plan)
  await vi.waitFor(()=>expect(ctx.features.call<any>('session.get',{id:started.id}).status).toBe('exited'),{timeout:6000})
  const session=ctx.features.call<LaunchSession>('session.get',{id:started.id})
  const log=await readFile(session.logFile,'utf8')
  expect(log).toContain('real stdout <redacted>');expect(log).toContain('real stderr');expect(log).not.toContain('private-game-token')
  expect(events.some(event=>event.type==='launch-log'&&event.lines.some(line=>line.message.includes('real stdout')))).toBe(true)
  expect(session.exitCode).toBe(0)
  expect(ctx.instances.get(plan.instance.id)?.lastLaunchedAt).toBeTypeOf('number')
  // Play-time accounting lands right after the exit event; wait for it rather than sampling mid-write.
  await vi.waitFor(()=>expect(ctx.instances.get(plan.instance.id)?.playTimeMs).toBeGreaterThan(0),{timeout:4000})
  await ctx.features.disable('launch.spawn')
  expect(ctx.features.call<LaunchSession>('session.get',{id:started.id}).status).toBe('exited')
  unsubscribe()
 })
 it('unloading the spawn feature stops the child but leaves session inspection available',async()=>{
  const {ctx,plan}=await host("console.log('started');setInterval(()=>console.log('tick'),200)")
  const session=await ctx.features.call<Promise<LaunchSession>>('launch.spawn',plan)
  expect(session.pid).toBeTypeOf('number')
  await ctx.features.disable('launch.spawn')
  const stopped=ctx.features.call<LaunchSession>('session.get',{id:session.id})
  expect(stopped.status).toBe('stopped');expect(stopped.endedAt).toBeTypeOf('number')
  expect(()=>process.kill(session.pid!,0)).toThrow()
  expect(ctx.features.has('session.list')).toBe(true)
  expect(ctx.features.has('launch.start')).toBe(false)
 })
 it('never treats command scripts as a Java executable',async()=>{
  const {ctx,plan}=await host('')
  plan.command=['C:/untrusted/test.cmd','&','whoami']
  await expect(ctx.features.call('launch.spawn',plan)).rejects.toThrow('实际可执行文件')
 })
})
