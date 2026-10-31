import type { FeatureRuntime,FeaturePlugin } from '@rhine/plugin-api'
import { FeatureError } from '@rhine/plugin-api'

export interface RouteMatch { plugin:FeaturePlugin; params:Record<string,string>; specificity:number }
export const MAX_BODY_BYTES=1024*1024

export function matchFeatureRoute(runtime:FeatureRuntime,method:string,pathname:string):RouteMatch|undefined {
  const matches:RouteMatch[]=[]
  for(const plugin of runtime.definitions()){
    const http=plugin.http
    if(!http||http.method!==method)continue
    const template=http.path.replace(/\/$/,'').split('/'),actual=pathname.replace(/\/$/,'').split('/')
    if(template.length!==actual.length)continue
    const params:Record<string,string>={};let match=true,specificity=0
    for(let i=0;i<template.length;i++){
      if(template[i].startsWith(':')){
        try{const value=decodeURIComponent(actual[i]);if(value.includes('/')||value.includes(String.fromCharCode(92))||value.includes(String.fromCharCode(0)))throw new Error('Invalid path');params[template[i].slice(1)]=value}catch{throw new FeatureError('VALIDATION_ERROR','路径编码或片段不合法',400)}
      }else if(template[i]!==actual[i]){match=false;break}else specificity++
    }
    if(match)matches.push({plugin,params,specificity})
  }
  matches.sort((a,b)=>b.specificity-a.specificity)
  if(matches.length>1&&matches[0].specificity===matches[1].specificity)throw new FeatureError('DUPLICATE_ROUTE','多个插件声明了同一个 HTTP 接口',500)
  return matches[0]
}

/** The transport only dispatches descriptors. It contains no account/loader/game branches. */
export async function dispatchFeature(runtime:FeatureRuntime,request:Request):Promise<Response>{
  await runtime.settled()
  const url=new URL(request.url)
  const match=matchFeatureRoute(runtime,request.method,url.pathname)
  if(!match)throw new FeatureError('NOT_FOUND','接口不存在：'+request.method+' '+url.pathname,404)
  if(!runtime.has(match.plugin.id))throw new FeatureError('PLUGIN_UNAVAILABLE','此功能插件未启用：'+match.plugin.id,503)
  const metadata=match.plugin.http!
  if(!['GET','HEAD'].includes(request.method)){
    const size=Number(request.headers.get('content-length'))
    if(size>MAX_BODY_BYTES)throw new FeatureError('PAYLOAD_TOO_LARGE','请求体超出限制',413)
    const reader=request.clone().body?.getReader();let readBytes=0
    if(reader){try{while(true){const item=await reader.read();if(item.done)break;readBytes+=item.value.byteLength;if(readBytes>MAX_BODY_BYTES){void reader.cancel().catch(()=>{});throw new FeatureError('PAYLOAD_TOO_LARGE','请求体超出限制',413)}}}finally{reader.releaseLock()}}
  }
  let input:unknown
  try{input=metadata.decode?await metadata.decode(request,match.params):request.method==='GET'?{...Object.fromEntries(url.searchParams),...match.params}:await request.json()}
  catch(error){if(error instanceof FeatureError)throw error;throw new FeatureError('VALIDATION_ERROR','请求参数无效：'+(error instanceof Error?error.message:String(error)),400)}
  if(metadata.background){
    const title=typeof metadata.background.title==='function'?metadata.background.title(input):metadata.background.title
    const taskId=runtime.call<string>('task.submit',{kind:metadata.background.kind,title,body:(task:any)=>runtime.call(match.plugin.id,input,{task,signal:task.signal})})
    return Response.json({taskId,title},{status:202})
  }
  const output=await runtime.call(match.plugin.id,input,{signal:request.signal})
  if(output===undefined&&request.method==='GET')throw new FeatureError('NOT_FOUND',metadata.notFoundMessage??'没有找到请求的资源',404)
  return Response.json(metadata.encode?metadata.encode(output,input):output??{ok:true},{status:metadata.status??200})
}

export function errorResponse(error:unknown):Response {
  const err=error as {code?:string;name?:string;status?:number;statusCode?:number;message?:string}
  const status=err.status??err.statusCode??(/NotFound/i.test(err.name??'')||/不存在|not found/i.test(err.message??'')?404:/必须|参数|非法|不允许|未填写|不能为空/.test(err.message??'')?400:500)
  const retry=error as {retryAfterMs?:number;intervalMs?:number}
  const hint:Record<string,number>={}
  for(const key of ['retryAfterMs','intervalMs'] as const)if(Number.isFinite(retry?.[key])&&retry[key]!>=0)hint[key]=retry[key]!
  return Response.json({code:err.code??(status===404?'NOT_FOUND':status===400?'VALIDATION_ERROR':'INTERNAL_ERROR'),message:status<500||err.message?err.message??'请求失败':'内部错误',...hint},{status:Math.min(599,Math.max(400,status))})
}

/** A local launcher must not accept browser requests from arbitrary websites. */
export function requireLocalRequest(request:Request,allowedOrigins:string[]=[]):void {
  const url=new URL(request.url)
  const host=url.hostname
  if(!['localhost','127.0.0.1','[::1]'].includes(host))throw new FeatureError('FORBIDDEN_HOST','启动器只接受本机请求',403)
  const origin=request.headers.get('origin')
  if(origin&&origin!==url.origin&&!allowedOrigins.includes(origin))throw new FeatureError('FORBIDDEN_ORIGIN','拒绝来自其他站点的请求',403)
  const site=request.headers.get('sec-fetch-site')
  if(site==='cross-site'&&!origin)throw new FeatureError('FORBIDDEN_ORIGIN','拒绝跨站请求',403)
}
