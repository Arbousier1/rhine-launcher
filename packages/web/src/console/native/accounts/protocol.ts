import {waitDelay} from '../operations'
export interface PublicDeviceFlow{flowId:string;userCode:string;verificationUri:string;intervalMs:number;expiresAt:number}
export function publicFlow(value:any):PublicDeviceFlow{
 if(!value||typeof value.flowId!=='string'||typeof value.userCode!=='string'||!Number.isFinite(value.intervalMs)||value.intervalMs<1000||!Number.isFinite(value.expiresAt))throw new Error('设备码信息不完整')
 const url=new URL(value.verificationUri);if(url.protocol!=='https:'||!/(^|\.)(microsoft\.com|microsoftonline\.com)$/.test(url.hostname))throw new Error('设备验证地址不是 Microsoft HTTPS 地址')
 return {flowId:value.flowId,userCode:value.userCode,verificationUri:url.href,intervalMs:value.intervalMs,expiresAt:value.expiresAt}
}
export async function completeDeviceFlow(call:<T>(id:string,input:Record<string,unknown>,signal:AbortSignal)=>Promise<T>,flow:PublicDeviceFlow,signal:AbortSignal,status:(text:string)=>void,delay=waitDelay){
 let pause=flow.intervalMs
 while(Date.now()<flow.expiresAt){
  signal.throwIfAborted();status('等待浏览器授权 · 剩余 '+Math.max(0,Math.ceil((flow.expiresAt-Date.now())/1000))+' 秒');await delay(Math.min(pause,Math.max(1,flow.expiresAt-Date.now())),signal)
  signal.throwIfAborted();if(Date.now()>=flow.expiresAt)break
  try{const account=await call<any>('launcher.accounts.microsoft.complete',{flowId:flow.flowId},signal);if(!account||account.kind!=='microsoft'||typeof account.id!=='string'||typeof account.name!=='string')throw new Error('没有返回已完成 Minecraft 认证的账号');return {id:account.id,name:account.name,kind:account.kind}}
  catch(error){if(signal.aborted)throw signal.reason;const problem=error as {code?:string;intervalMs?:number;retryAfterMs?:number;message?:string};if(problem.code==='authorization_pending'||problem.code==='slow_down'){pause=Math.max(flow.intervalMs,problem.intervalMs??pause+(problem.code==='slow_down'?5000:0),problem.retryAfterMs??0);continue}throw error}
 }
 throw new Error('设备码已过期，请重新开始登录')
}
