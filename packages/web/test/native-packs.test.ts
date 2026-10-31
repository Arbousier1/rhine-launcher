import {describe,it,expect,vi} from 'vitest'
import {waitNativeTask,taskId,waitDelay} from '../src/console/native/operations'
describe('native pack task contract',()=>{
 it('requires the exact queued task id rather than assuming successful import',()=>{expect(taskId({taskId:'task-1'})).toBe('task-1');expect(()=>taskId({ok:true})).toThrow();expect(()=>taskId(null)).toThrow()})
 it('accepts success only for the matching terminal task',async()=>{const progress=vi.fn(),ctx={signal:new AbortController().signal,call:vi.fn(async()=>({id:'task-1',status:'succeeded'}))} as any;expect(await waitNativeTask(ctx,'task-1',progress)).toEqual({id:'task-1',status:'succeeded'});expect(ctx.call).toHaveBeenCalledWith('launcher.tasks.get',{id:'task-1'},ctx.signal)})
 it('preserves failure/cancellation and rejects mismatched/unknown tasks',async()=>{for(const value of [{id:'task-1',status:'failed',error:'哈希校验失败'},{id:'task-1',status:'cancelled'},{id:'other',status:'succeeded'},{id:'task-1',status:'unknown'}]){const ctx={signal:new AbortController().signal,call:async()=>value} as any;await expect(waitNativeTask(ctx,'task-1',()=>{})).rejects.toThrow()}})
 it('closing a pane cancels its wait without fabricating remote task cancellation',async()=>{const controller=new AbortController();controller.abort();await expect(waitDelay(1000,controller.signal)).rejects.toThrow();const ctx={signal:controller.signal,call:vi.fn()} as any;await expect(waitNativeTask(ctx,'task-1',()=>{})).rejects.toThrow();expect(ctx.call).not.toHaveBeenCalled()})
})
