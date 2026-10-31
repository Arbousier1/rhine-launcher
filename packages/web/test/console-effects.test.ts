import {afterEach,describe,it,expect,vi} from 'vitest'
import {FeatureRuntime,defineFeature} from '@rhine/plugin-api'
import {ownedEffects} from '../src/console/runtime-effects'
afterEach(()=>vi.unstubAllGlobals())
describe('native terminal effect ownership',()=>{
 it('removes input listeners, pending frames and timers when its fiber stops, and re-enables cleanly',async()=>{
  let seq=0,clicks=0,framesRun=0,timersRun=0,releases=0
  const frames=new Map<number,FrameRequestCallback>(),timers=new Map<number,()=>void>(),target=new EventTarget()
  vi.stubGlobal('window',{requestAnimationFrame:(cb:FrameRequestCallback)=>{const id=++seq;frames.set(id,cb);return id},cancelAnimationFrame:(id:number)=>frames.delete(id),setTimeout:(cb:()=>void)=>{const id=++seq;timers.set(id,cb);return id},clearTimeout:(id:number)=>timers.delete(id)})
  const runtime=new FeatureRuntime()
  runtime.register(defineFeature({id:'native.ui',capability:'native.ui',execute(_input,env){const effects=ownedEffects(env);effects.listen(target,'click',()=>clicks++);effects.requestAnimationFrame(()=>framesRun++);effects.setTimeout(()=>timersRun++,100);effects.add(()=>{releases++})}}))
  await runtime.start();await runtime.call('native.ui')
  target.dispatchEvent(new Event('click'));expect(clicks).toBe(1);expect(frames.size).toBe(1);expect(timers.size).toBe(1)
  const staleFrame=[...frames.values()][0],staleTimer=[...timers.values()][0]
  await runtime.disable('native.ui')
  expect(frames.size).toBe(0);expect(timers.size).toBe(0);expect(releases).toBe(1)
  target.dispatchEvent(new Event('click'));staleFrame(10);staleTimer();expect(clicks).toBe(1);expect(framesRun).toBe(0);expect(timersRun).toBe(0)
  await runtime.enable('native.ui');await runtime.call('native.ui');target.dispatchEvent(new Event('click'));expect(clicks).toBe(2)
  await runtime.dispose();expect(releases).toBe(2)
 })
 it('releases owned effects in reverse acquisition order',async()=>{
  vi.stubGlobal('window',{cancelAnimationFrame:vi.fn(),clearTimeout:vi.fn()})
  const order:number[]=[],runtime=new FeatureRuntime()
  runtime.register(defineFeature({id:'native.order',capability:'native.order',execute(_input,env){const effects=ownedEffects(env);effects.add(()=>{order.push(1)});effects.add(async()=>{order.push(2)})}}))
  await runtime.start();await runtime.call('native.order');await runtime.disable('native.order');expect(order).toEqual([2,1]);await runtime.dispose()
 })
})
