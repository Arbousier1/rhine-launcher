import {describe,it,expect} from 'vitest'
import {publicFlow,completeDeviceFlow} from '../src/console/native/accounts/protocol'
const publicCode={flowId:'flow-1',userCode:'ABCD-EFGH',verificationUri:'https://microsoft.com/link',intervalMs:5000,expiresAt:Date.now()+120000}
describe('native Microsoft login is real, bounded, and cancelable',()=>{
 it('projects only public flow fields, never device-code/token secrets',()=>{expect(publicFlow({...publicCode,deviceCode:'SECRET',accessToken:'TOKEN'})).toEqual(publicCode)})
 it('rejects missing flow fields and non-Microsoft verification hosts',()=>{expect(()=>publicFlow({})).toThrow();expect(()=>publicFlow({...publicCode,verificationUri:'https://microsoft.com.attacker.test/'})).toThrow();expect(()=>publicFlow({...publicCode,verificationUri:'http://microsoft.com/link'})).toThrow()})
 it('honors pending/slow_down retry hints before genuine Minecraft account completion',async()=>{
  const requests:any[]=[],waits:number[]=[],signal=new AbortController().signal;let n=0
  const call=async(id:string,input:any)=>{requests.push({id,input});n++;if(n===1)throw Object.assign(new Error('等待授权'),{code:'authorization_pending',retryAfterMs:6000});if(n===2)throw Object.assign(new Error('请降低频率'),{code:'slow_down',intervalMs:11000});return {id:'ms-1',name:'Alex',kind:'microsoft',accessToken:'SECRET'}}
  const result=await completeDeviceFlow(call as any,publicCode,signal,()=>{},async(ms)=>{waits.push(ms)})
  expect(waits).toEqual([5000,6000,11000]);expect(result).toEqual({id:'ms-1',name:'Alex',kind:'microsoft'});expect(requests.every(r=>r.id==='launcher.accounts.microsoft.complete'&&r.input.flowId==='flow-1')).toBe(true)
 })
 it('does not silently fall back to offline or another identity',async()=>{await expect(completeDeviceFlow((async()=>({kind:'offline',id:'other',name:'Steve'})) as any,publicCode,new AbortController().signal,()=>{},async()=>{})).rejects.toThrow('Minecraft 认证')})
 it('cancellation stops polling; expiration never polls',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;const call=async()=>{calls++;return {}}
  await expect(completeDeviceFlow(call as any,publicCode,controller.signal,()=>{})).rejects.toThrow();expect(calls).toBe(0)
  await expect(completeDeviceFlow(call as any,{...publicCode,expiresAt:0},new AbortController().signal,()=>{})).rejects.toThrow('过期');expect(calls).toBe(0)
 })
 it('preserves genuine unauthorized_client failures rather than reporting logged in',async()=>{await expect(completeDeviceFlow((async()=>{throw Object.assign(new Error('应用不允许设备码登录'),{code:'unauthorized_client'})}) as any,publicCode,new AbortController().signal,()=>{},async()=>{})).rejects.toThrow('应用不允许')})
})
