import {describe,it,expect,vi} from 'vitest'
import {NativeSubmissionGate,waitNativeQueue} from '../src/console/rendering/native-submission'
function pending(){let resolve!:()=>void,reject!:(error:unknown)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
describe('native GPU queue ownership',()=>{
 it('bounds in-flight submission without blocking the main thread',async()=>{const p=pending(),queue={onSubmittedWorkDone:vi.fn(()=>p.promise)},gate=new NativeSubmissionGate(queue,vi.fn());expect(gate.ready()).toBe(true);gate.submitted();for(let i=0;i<10;i++)expect(gate.ready()).toBe(false);expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce();p.resolve();await p.promise;expect(gate.ready()).toBe(true);expect(gate.deferredFrames).toBe(10)})
 it('does not revive a disposed or superseded queue generation',async()=>{const p=pending(),gate=new NativeSubmissionGate({onSubmittedWorkDone:()=>p.promise},vi.fn());gate.submitted();gate.dispose();p.resolve();await p.promise;expect(gate.ready()).toBe(false)})
 it('forwards genuine submission failure for full backend fallback',async()=>{const p=pending(),lost=vi.fn(),gate=new NativeSubmissionGate({onSubmittedWorkDone:()=>p.promise},lost);gate.submitted();p.reject(new Error('device lost'));await Promise.resolve();expect(lost).toHaveBeenCalledOnce()})
 it('cancels preparation while still consuming eventual queue rejection',async()=>{const p=pending(),controller=new AbortController(),waiting=waitNativeQueue({onSubmittedWorkDone:()=>p.promise},controller.signal);controller.abort();await expect(waiting).rejects.toThrow();p.reject(new Error('late device error'));await Promise.resolve()})
})
