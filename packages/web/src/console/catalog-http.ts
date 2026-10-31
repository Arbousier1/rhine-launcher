import {FeatureError,type FeatureEnvironment} from '@rhine/plugin-api'
/** HTTP protocol helper; every caller's action owns its cancellation signal. */
export async function catalogRequest<T>(env:FeatureEnvironment,path:string,body?:unknown):Promise<T>{
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:env.signal})
 const text=await response.text();let value:any
 try{value=text?JSON.parse(text):undefined}catch{throw new FeatureError('INVALID_RESPONSE','启动器返回了无效响应',502)}
 if(!response.ok)throw new FeatureError(value?.code??'HTTP_ERROR',value?.message??'请求失败：'+response.status,response.status)
 return value as T
}
export function inputId(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>256)throw new FeatureError('INVALID_INPUT','需要有效的版本或任务 id',400);return encodeURIComponent(value)}
export function loaderKind(value:unknown):string{if(!['fabric','quilt','forge','neoforge','optifine'].includes(String(value)))throw new FeatureError('INVALID_INPUT','请选择支持的加载器',400);return String(value)}
