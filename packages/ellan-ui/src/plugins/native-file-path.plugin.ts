import {defineFeature} from '@rhine/plugin-api'
interface Controller {getPathForFile(file:File):string}
interface NativeFiles {nativeFilePath(file:File):string}
function native():NativeFiles|undefined{
 const bridge:unknown=Reflect.get(window,'rhineDesktop')
 if(bridge&&typeof bridge==='object'&&typeof Reflect.get(bridge,'nativeFilePath')==='function')return bridge as NativeFiles
 try{if(window.parent!==window&&window.parent.location.protocol===window.location.protocol&&window.parent.location.host===window.location.host){const parent:unknown=Reflect.get(window.parent,'rhineDesktop');if(parent&&typeof parent==='object'&&typeof Reflect.get(parent,'nativeFilePath')==='function')return parent as NativeFiles}}catch{/* A foreign parent is not a native host. */}
 return undefined
}
export function actualNativeFilePath(file:File):string{
 const host=native()
 if(!host)throw new Error('This document has no native file-path capability')
 const value=host.nativeFilePath(file)
 if(typeof value!=='string')throw new Error('Invalid native file-path result')
 return value // Empty means browser-created File, never a guessed filename/path.
}
export default defineFeature<File,string>({
 id:'ui.files.native-path',capability:'ui.files.native-path',title:'原生文件路径',execute:file=>actualNativeFilePath(file),
 async setup(env){
  if(!document.body)await new Promise<void>((resolve,reject)=>{const done=()=>{env.signal.removeEventListener('abort',abort);resolve()};const abort=()=>{document.removeEventListener('DOMContentLoaded',done);reject(env.signal.reason)};document.addEventListener('DOMContentLoaded',done,{once:true});env.signal.addEventListener('abort',abort,{once:true})})
  env.signal.throwIfAborted()
  const controller:unknown=Reflect.get(window,'windowController')
  if(!native()||!controller||typeof controller!=='object'||typeof Reflect.get(controller,'getPathForFile')!=='function')throw new Error('Original native file controller is unavailable')
  const target=controller as Controller,previous=target.getPathForFile
  const resolve=(file:File)=>actualNativeFilePath(file)
  target.getPathForFile=resolve
  env.onDispose(()=>{if(target.getPathForFile===resolve)target.getPathForFile=previous})
 }
})
