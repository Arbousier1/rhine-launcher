import {afterEach,describe,it,expect,vi} from 'vitest'
import {FeatureRuntime} from '@rhine/plugin-api'
import taskWait from '../src/console/catalog-plugins/task-wait.plugin'
afterEach(()=>vi.unstubAllGlobals())
async function host(){const runtime=new FeatureRuntime();runtime.register(taskWait);await runtime.start();return runtime}
describe('native installation waits on the real task contract',()=>{
 it('uses GET task/:id and preserves its exact succeeded snapshot',async()=>{
  const result={id:'task-1',status:'succeeded',progress:{value:1,message:'已完成'}}
  const fetch=vi.fn(async()=>Response.json(result));vi.stubGlobal('fetch',fetch)
  const runtime=await host();try{expect(await runtime.call('launcher.task.wait',{id:'task-1'})).toEqual(result);expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1',expect.objectContaining({method:'GET'}))}finally{await runtime.dispose()}
 })
 it('continues while actually queued/running, without inventing completion',async()=>{
  const states=['queued','running','succeeded'];let calls=0
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'task-2',status:states[calls++]})))
  const runtime=await host();try{expect(await runtime.call('launcher.task.wait',{id:'task-2'})).toEqual({id:'task-2',status:'succeeded'});expect(calls).toBe(3)}finally{await runtime.dispose()}
 })
 it('stops its in-flight wait when the feature is disabled',async()=>{
  let requested!:()=>void;const request=new Promise<void>(resolve=>{requested=resolve})
  const fetch=vi.fn(async()=>{requested();return Response.json({id:'task-3',status:'running'})});vi.stubGlobal('fetch',fetch)
  const runtime=await host();const pending=Promise.resolve(runtime.call('launcher.task.wait',{id:'task-3'}));void pending.catch(()=>{})
  await request;await runtime.disable('launcher.task.wait');await expect(pending).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);await runtime.dispose()
 })
 it('preserves failed/cancelled outcomes rather than treating them as successes',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'task-4',status:'failed',error:'校验失败'})))
  const runtime=await host();try{expect(await runtime.call('launcher.task.wait',{id:'task-4'})).toMatchObject({status:'failed',error:'校验失败'})}finally{await runtime.dispose()}
 })
 it('rejects a malformed status instead of waiting forever',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'task-5',status:'unknown'})))
  const runtime=await host();try{await expect(Promise.resolve(runtime.call('launcher.task.wait',{id:'task-5'}))).rejects.toThrow('未知任务状态')}finally{await runtime.dispose()}
 })
})
