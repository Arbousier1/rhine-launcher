import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DownloadApi, DownloadItem, DownloadOptions, TaskHandle } from '../contracts.ts'

const DEFAULT_RETRIES = 2
const TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 1024 * 1024 * 1024
const MAX_TEXT_BYTES = 32 * 1024 * 1024
export class DownloadError extends Error {
  constructor(message: string, readonly url: string) { super(message); this.name = 'DownloadError' }
}
interface ReadOptions { signal?:AbortSignal; timeoutMs?:number; retries?:number; maxBytes?:number }

/** A pure HTTP implementation. Only atomic download.* plugins expose operations. */
export class DownloadService implements DownloadApi {
  constructor(protected ctx: Context) {}

  async file(options: DownloadOptions): Promise<number> {
    const urls=[...new Set([options.url,...(options.mirrors??[])])]
    for(const url of urls) validateDownloadUrl(url)
    throwIfAborted(options.signal)
    if(options.skipIfExists!==false && await matchesFile(options.destination,options)) return (await stat(options.destination)).size
    await mkdir(dirname(options.destination),{recursive:true})
    let lastError:unknown
    for(const url of urls) {
      for(let attempt=0;attempt<=(options.retries??DEFAULT_RETRIES);attempt++) {
        throwIfAborted(options.signal)
        const temp=options.destination+'.'+randomUUID()+'.part'
        try {
          const bytes=await this.downloadTo(url,temp,options)
          throwIfAborted(options.signal)
          await rename(temp,options.destination)
          return bytes
        } catch(error) {
          lastError=error
          await unlink(temp).catch(()=>{})
          throwIfAborted(options.signal)
          if(attempt<(options.retries??DEFAULT_RETRIES)) await delay(250*2**attempt,options.signal)
        }
      }
    }
    throw new DownloadError('下载失败：'+options.url+'（'+message(lastError)+'）',options.url)
  }

  async batch(items:DownloadItem[],handle?:TaskHandle,concurrency?:number):Promise<void> {
    const controller=new AbortController()
    const signal=handle?.signal ? AbortSignal.any([controller.signal,handle.signal]) : controller.signal
    let next=0, completed=0
    const total=items.length
    handle?.setProgress({stage:'download',current:0,total,value:total?0:1})
    const worker=async()=>{
      while(next<total){
        handle?.throwIfCancelled()
        throwIfAborted(signal)
        const item=items[next++]
        const combined=item.signal?AbortSignal.any([signal,item.signal]):signal
        try { await this.file({...item,signal:combined}) }
        catch(error){controller.abort(error);throw error}
        handle?.throwIfCancelled()
        handle?.setProgress({stage:'download',current:++completed,total,value:total?completed/total:1})
      }
    }
    const count=Math.min(Math.max(1,Math.floor(concurrency??this.ctx.settings.get().concurrency)),Math.max(total,1))
    const results=await Promise.allSettled(Array.from({length:count},worker))
    const failed=results.find((result):result is PromiseRejectedResult=>result.status==='rejected')
    if(failed) throw failed.reason
  }

  async text(url:string,options:ReadOptions={}):Promise<string>{return Buffer.from(await this.buffer(url,options)).toString('utf8')}
  async buffer(url:string,options:ReadOptions={}):Promise<Uint8Array>{
    validateDownloadUrl(url)
    let last:unknown
    for(let attempt=0;attempt<=(options.retries??DEFAULT_RETRIES);attempt++){
      throwIfAborted(options.signal)
      const controller=new AbortController()
      const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal
      const timeout=setTimeout(()=>controller.abort(new Error('请求超时')),options.timeoutMs??TIMEOUT_MS)
      try{
        const response=await fetch(url,{signal,headers:{'user-agent':'RhineLauncher/0.2.0'}})
        if(!response.ok)throw new DownloadError('HTTP '+response.status+'：'+url,url)
        const limit=options.maxBytes??MAX_TEXT_BYTES
        const reader=response.body?.getReader()
        if(!reader)return new Uint8Array()
        const chunks:Uint8Array[]=[];let size=0
        try{
          while(true){const item=await reader.read();if(item.done)break;throwIfAborted(signal);size+=item.value.byteLength;if(size>limit)throw new DownloadError('响应超过大小限制：'+url,url);chunks.push(item.value)}
        }catch(error){await reader.cancel().catch(()=>{});throw error}
        const joined=new Uint8Array(size);let offset=0
        for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length}
        return joined
      }catch(error){last=error;throwIfAborted(options.signal);if(attempt<(options.retries??DEFAULT_RETRIES))await delay(250*2**attempt,options.signal)}
      finally{clearTimeout(timeout)}
    }
    throw new DownloadError('读取失败：'+url+'（'+message(last)+'）',url)
  }

  private async downloadTo(url:string,temp:string,options:DownloadOptions):Promise<number>{
    const controller=new AbortController()
    const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal
    const timeout=setTimeout(()=>controller.abort(new Error('下载超时')),options.timeoutMs??120_000)
    const hashes={sha1:createHash('sha1'),sha256:createHash('sha256'),sha512:createHash('sha512')}
    let file:Awaited<ReturnType<typeof open>>|undefined
    try{
      const response=await fetch(url,{signal,headers:{'user-agent':'RhineLauncher/0.2.0'}})
      if(!response.ok)throw new DownloadError('HTTP '+response.status+'：'+url,url)
      const length=Number(response.headers.get('content-length'))
      const limit=options.maxBytes??MAX_FILE_BYTES
      if(Number.isFinite(length)&&length>limit)throw new DownloadError('文件超过大小限制：'+url,url)
      if(!response.body)throw new DownloadError('下载返回空文件：'+url,url)
      file=await open(temp,'wx')
      const reader=response.body.getReader();let bytes=0
      try{
        while(true){
          const item=await reader.read();if(item.done)break
          throwIfAborted(signal)
          bytes+=item.value.byteLength
          if(bytes>limit)throw new DownloadError('文件超过大小限制：'+url,url)
          for(const hash of Object.values(hashes))hash.update(item.value)
          let offset=0
          while(offset<item.value.length){const result=await file.write(item.value,offset,item.value.length-offset);offset+=result.bytesWritten}
        }
      }catch(error){await reader.cancel().catch(()=>{});throw error}
      if(bytes===0&&options.size!==0)throw new DownloadError('下载返回空文件：'+url,url)
      if(options.size!==undefined&&bytes!==options.size)throw new DownloadError('文件大小校验失败：'+url,url)
      for(const algorithm of ['sha1','sha256','sha512'] as const){
        const actual=hashes[algorithm].digest('hex')
        if(options[algorithm]&&options[algorithm]!.toLowerCase()!==actual)throw new DownloadError('文件 '+algorithm+' 校验失败：'+url,url)
      }
      await file.sync()
      return bytes
    }finally{clearTimeout(timeout);await file?.close()}
  }
}

export function validateDownloadUrl(value:string):void{
  const url=new URL(value)
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))){
    throw new DownloadError('下载只允许 HTTPS；HTTP 仅限本机测试服务',value)
  }
  if(url.username||url.password)throw new DownloadError('下载 URL 不允许嵌入账号密码',value)
}
export async function sha1Of(path:string):Promise<string|undefined>{try{return await hashFile(path,'sha1')}catch{return undefined}}
export async function hashFile(path:string,algorithm:'sha1'|'sha256'|'sha512'):Promise<string>{
  const hash=createHash(algorithm)
  for await(const chunk of createReadStream(path))hash.update(chunk)
  return hash.digest('hex')
}
export async function verifyFile(path:string,sha1:string):Promise<boolean>{const actual=await sha1Of(path);return !!actual&&actual.toLowerCase()===sha1.toLowerCase()}
export function hashBuffer(buffer:Uint8Array):string{return createHash('sha1').update(buffer).digest('hex')}
async function matchesFile(path:string,options:DownloadOptions):Promise<boolean>{
  try{
    const info=await stat(path);if(!info.isFile()||info.size===0)return false
    if(options.size!==undefined&&info.size!==options.size)return false
    let proved=options.size!==undefined
    for(const algorithm of ['sha1','sha256','sha512'] as const){if(options[algorithm]){proved=true;if(await hashFile(path,algorithm)!==options[algorithm]!.toLowerCase())return false}}
    return proved
  }catch{return false}
}
function throwIfAborted(signal?:AbortSignal):void{if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new Error('下载已取消')}
function message(error:unknown):string{return error instanceof Error?error.message:String(error)}
function delay(ms:number,signal?:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal?.reason??new Error('下载已取消'))};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);if(signal?.aborted){abort();return}signal?.addEventListener('abort',abort,{once:true})})
}
