import {spawn} from 'node:child_process'
import {stat,realpath} from 'node:fs/promises'
import {isAbsolute,relative} from 'node:path'
import {FeatureError,type FeatureEnvironment} from '@rhine/plugin-api'
import type {RhPaths} from '../contracts.ts'

async function executeFileManager(args:string[]):Promise<void>{
 await new Promise<void>((resolve,reject)=>{
  const command=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open'
  const child=spawn(command,args,{stdio:'ignore',detached:true,shell:false,windowsHide:true})
  child.once('spawn',()=>{child.unref();resolve()});child.once('error',reject)
 })
}
export async function reveal(path:string,env:FeatureEnvironment):Promise<void>{
 if(!isAbsolute(path))throw new FeatureError('invalid_path','需要绝对路径',400)
 const paths=env.use<RhPaths>('paths.get'),target=await realpath(path)
 let allowed=false
 for(const directory of [paths.root,paths.instances,paths.java,paths.logs]){const base=await realpath(directory).catch(()=>undefined);if(base){const rel=relative(base,target);if(rel===''||!rel.startsWith('..')&&!isAbsolute(rel))allowed=true}}
 if(!allowed)throw new FeatureError('invalid_path','只能打开启动器数据或实例目录内的路径',400)
 const file=await stat(target)
 await executeFileManager(process.platform==='win32'&&!file.isDirectory()?['/select,',target]:[target])
}
export async function openExternal(url:string):Promise<void>{
 const parsed=new URL(url)
 if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new FeatureError('invalid_url','只能打开普通 http/https 地址',400)
 if(process.platform==='win32'){
  await new Promise<void>((resolve,reject)=>{const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',parsed.href],{stdio:'ignore',shell:false,windowsHide:true});child.once('spawn',()=>{child.unref();resolve()});child.once('error',reject)})
 }else await executeFileManager([parsed.href])
}
