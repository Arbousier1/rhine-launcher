import {FeatureError,type FeatureEnvironment} from '@rhine/plugin-api'
export interface NativeRequest{method?:string;body?:unknown;signal?:AbortSignal;headers?:Record<string,string>}
/** Private transport algorithm: one public operation lives in each plugin file. */
export async function nativeRequest<T>(env:FeatureEnvironment,path:string,options:NativeRequest={}):Promise<T>{
 const signal=options.signal?AbortSignal.any([env.signal,options.signal]):env.signal
 const response=await fetch(path,{method:options.method??(options.body===undefined?'GET':'POST'),headers:{...(options.body===undefined?{}:{'content-type':'application/json'}),...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body),signal})
 const text=await response.text();let result:any
 try{result=text?JSON.parse(text):undefined}catch{throw new FeatureError('INVALID_RESPONSE','启动器返回了无效响应',502)}
 if(!response.ok){const error=new FeatureError(result?.code??'HTTP_ERROR',result?.message??'请求失败：'+response.status,response.status);for(const key of ['retryAfterMs','intervalMs'])if(Number.isFinite(result?.[key])&&result[key]>=0)Object.assign(error,{[key]:result[key]});throw error}
 return result as T
}
export function pathId(value:unknown):string{if(typeof value!=='string'||!value||value.length>512)throw new FeatureError('INVALID_INPUT','需要有效的标识符',400);return encodeURIComponent(value)}
