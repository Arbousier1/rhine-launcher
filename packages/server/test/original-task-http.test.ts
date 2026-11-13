import {describe,it,expect} from 'vitest'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLauncherContext,defineFeature} from '@rhine/core'
import {dispatchFeature} from '../src/plugin-http.ts'
describe('original RPC over backend-owned tasks',()=>{
 it('keeps the original result envelope and real progress/events',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rhine-rpc-task-')),ctx=await createLauncherContext({root})
  try{
   const events:unknown[]=[];const off=ctx.features.call<()=>void>('events.subscribe',(event:unknown)=>events.push(event))
   ctx.features.register(defineFeature({id:'fixture.rpc',capability:'fixture.rpc',title:'Fixture original operation',http:{method:'POST',path:'/api/fixture-rpc',decode:()=>undefined,background:{kind:'installInstance',title:'Fixture installation',waitForResult:true}},async execute(_input,env){env.task?.setProgress({stage:'download',current:2,total:3,value:2/3});return{result:{version:'actual-fixture',taskId:env.task?.id}}}}))
   await ctx.features.enable('fixture.rpc')
   const response=await dispatchFeature(ctx.features,new Request('http://127.0.0.1/api/fixture-rpc',{method:'POST'}))
   expect(response.status).toBe(200)
   const result=await response.json()
   expect(result.result.version).toBe('actual-fixture')
   expect(result.result.taskId).toMatch(/^task-/)
   const task=ctx.features.call<{status:string;progress:{current:number}}>('task.get',{id:result.result.taskId})
   expect(task.status).toBe('succeeded');expect(task.progress.current).toBe(2)
   expect(events.some(e=>e&&typeof e==='object'&&Reflect.get(e,'type')==='ellan'&&Reflect.get(e,'channel')==='task-activated')).toBe(true)
   off()
  }finally{await ctx.features.dispose();await rm(root,{recursive:true,force:true})}
 },15000)
 it('aborts only the HTTP wait when the document closes, not the owned task',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rhine-rpc-wait-')),ctx=await createLauncherContext({root})
  let finish:(()=>void)|undefined
  try{
   let taskSignal:AbortSignal|undefined
   ctx.features.register(defineFeature({id:'fixture.long-rpc',capability:'fixture.long-rpc',title:'Long fixture',http:{method:'POST',path:'/api/long-rpc',decode:()=>undefined,background:{kind:'installInstance',title:'Long fixture',waitForResult:true}},async execute(_input,env){taskSignal=env.signal;await new Promise<void>(resolve=>{finish=resolve});return{result:'done'}}}))
   await ctx.features.enable('fixture.long-rpc')
   const caller=new AbortController(),waiting=dispatchFeature(ctx.features,new Request('http://127.0.0.1/api/long-rpc',{method:'POST',signal:caller.signal}))
   const rejected=expect(waiting).rejects.toMatchObject({code:'PLUGIN_CANCELLED'})
   while(!finish)await new Promise(resolve=>setTimeout(resolve,5))
   caller.abort();await rejected
   expect(taskSignal?.aborted).toBe(false)
   finish()
   const tasks=ctx.features.call<{id:string}[]>('task.list')
   const result=await ctx.features.call<Promise<{status:string}>>('task.wait',{id:tasks[0].id})
   expect(result.status).toBe('succeeded')
  }finally{finish?.();await ctx.features.dispose();await rm(root,{recursive:true,force:true})}
 },15000)
})
