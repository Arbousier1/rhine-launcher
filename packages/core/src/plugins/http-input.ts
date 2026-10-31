import { FeatureError } from '@rhine/plugin-api'

export function object(value: unknown, label='请求'): Record<string,any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeatureError('VALIDATION_ERROR',label+'必须是 JSON 对象',400)
  return value as Record<string,any>
}
export async function json(request: Request): Promise<Record<string,any>> {
  const length=Number(request.headers.get('content-length'))
  if(length>1024*1024)throw new FeatureError('PAYLOAD_TOO_LARGE','请求体超过 1 MiB',413)
  const raw=await request.text()
  if(Buffer.byteLength(raw)>1024*1024)throw new FeatureError('PAYLOAD_TOO_LARGE','请求体超过 1 MiB',413)
  try{return object(JSON.parse(raw||'{}'))}catch(error){if(error instanceof FeatureError)throw error;throw new FeatureError('VALIDATION_ERROR','请求体不是有效 JSON',400)}
}
export function string(value:unknown,label='值',max=1024):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new FeatureError('VALIDATION_ERROR',label+'必须是非空字符串（最长 '+max+' 字符）',400)
  return value.trim()
}
export function identifier(value:unknown,label='id'):string {
  const id=string(value,label,180)
  // Instance ids come from user-visible archive names, so '-' and CJK are valid;
  // separators, traversal, control characters and device names are not.
  if(id==='.'||id==='..'||id.includes('..')||/[\\/:*?"<>|]/.test(id)||/[\u0000-\u001f\u007f]/.test(id)||/[. ]$/.test(id)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])([.]|$)/i.test(id))throw new FeatureError('VALIDATION_ERROR',label+'含非法路径片段',400)
  return id
}
export function readId(input:unknown):string{return identifier(typeof input==='string'?input:object(input).id)}
export function query(request:Request):Record<string,string>{return Object.fromEntries(new URL(request.url).searchParams.entries())}
export function flag(value:unknown,label:string,fallback=false):boolean {
  if(value===undefined)return fallback
  if(value===true||value==='true'||value==='1')return true
  if(value===false||value==='false'||value==='0')return false
  throw new FeatureError('VALIDATION_ERROR',label+'必须是布尔值',400)
}
export function integer(value:unknown,label:string,min:number,max:number,fallback?:number):number {
  if(value===undefined||value===''){if(fallback!==undefined)return fallback;throw new FeatureError('VALIDATION_ERROR','缺少 '+label,400)}
  const parsed=Number(value)
  if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new FeatureError('VALIDATION_ERROR',label+'必须在 '+min+' 到 '+max+' 之间',400)
  return parsed
}
