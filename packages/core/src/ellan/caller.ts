import { AsyncLocalStorage } from 'node:async_hooks'
const callers=new AsyncLocalStorage<string>()
export function withOriginalCaller<T>(rendererId:string, action:()=>T):T{return callers.run(rendererId,action)}
export function currentOriginalCaller():string|undefined{return callers.getStore()}
