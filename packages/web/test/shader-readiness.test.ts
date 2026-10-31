import {describe,it,expect,vi} from 'vitest'
import {waitForShaderPrograms} from '../src/console/shader-readiness'
describe('shader preparation does not defer compilation stalls into interaction',()=>{
 it('prepares the exact ready shader caches before resolving',async()=>{const a={isReady:()=>true,getUniforms:vi.fn()},b={isReady:()=>true,getUniforms:vi.fn()};await waitForShaderPrograms([a,b],new AbortController().signal);expect(a.getUniforms).toHaveBeenCalledOnce();expect(b.getUniforms).toHaveBeenCalledOnce()})
 it('cancels pending polling and never touches destroyed program caches',async()=>{const controller=new AbortController(),program={isReady:()=>false,getUniforms:vi.fn()},promise=waitForShaderPrograms([program],controller.signal);controller.abort();await expect(promise).rejects.toThrow();expect(program.getUniforms).not.toHaveBeenCalled()})
 it('retains real compile failures instead of suppressing error checking',async()=>{await expect(waitForShaderPrograms([{isReady:()=>true,getUniforms:()=>{},diagnostics:{runnable:false}}],new AbortController().signal)).rejects.toThrow('编译失败')})
 it('does not poll forever if the driver never completes',async()=>{await expect(waitForShaderPrograms([{isReady:()=>false,getUniforms:()=>{}}],new AbortController().signal,-1)).rejects.toThrow('超时')})
})
