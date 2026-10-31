import { FeatureError } from '@rhine/plugin-api'
import type { InstanceConfig, LaunchRequest, Settings } from '../types.ts'
import { identifier, integer, object, string } from './http-input.ts'

const fail = (message:string):never => { throw new FeatureError('VALIDATION_ERROR',message,400) }
function keys(value:Record<string,any>,allowed:string[]):void { for(const key of Object.keys(value)) if(!allowed.includes(key)) fail('未知字段：'+key) }
function strings(value:unknown,key:string):string[] {
 if(!Array.isArray(value)||value.length>100||value.some(item=>typeof item!=='string'||item.length>4000||item.includes(String.fromCharCode(0)))) fail(key+'必须是字符串数组')
 return value as string[]
}
const instanceKeys=['name','gameVersion','loaders','javaPath','memory','jvmArgs','gameArgs','window','icon','notes']
export function instancePatch(input:unknown,partial=true):Partial<InstanceConfig> {
 const body=object(input); keys(body,instanceKeys); const out:Record<string,any>={}
 if(!partial||body.name!==undefined)out.name=string(body.name,'name（档案名称）',120)
 if(!partial||body.gameVersion!==undefined)out.gameVersion=identifier(body.gameVersion,'游戏版本')
 if(body.loaders!==undefined){
  if(!Array.isArray(body.loaders)||body.loaders.length>5)fail('loaders必须是数组')
  out.loaders=body.loaders.map((entry:unknown)=>{const loader=object(entry);keys(loader,['kind','version']);if(!['vanilla','fabric','quilt','forge','neoforge','optifine','liteloader'].includes(loader.kind))fail('未知加载器');return {kind:loader.kind,...(loader.version?{version:identifier(loader.version,'加载器版本')}:{})}}).filter((loader:any)=>loader.kind!=='vanilla')
 }
 if(body.javaPath!==undefined){if(typeof body.javaPath!=='string'||body.javaPath.length>4096)fail('Java路径无效');out.javaPath=body.javaPath}
 if(body.memory!==undefined){const m=object(body.memory);keys(m,['minMb','maxMb']);const minMb=integer(m.minMb,'minMb',128,262144),maxMb=integer(m.maxMb,'maxMb',128,262144);if(minMb>maxMb)fail('最小内存不能大于最大内存');out.memory={minMb,maxMb}}
 if(body.jvmArgs!==undefined)out.jvmArgs=strings(body.jvmArgs,'jvmArgs')
 if(body.gameArgs!==undefined)out.gameArgs=strings(body.gameArgs,'gameArgs')
 if(body.window!==undefined){const w=object(body.window);keys(w,['width','height','fullscreen']);if(w.fullscreen!==undefined&&typeof w.fullscreen!=='boolean')fail('fullscreen必须是布尔值');out.window={width:integer(w.width,'width',320,16384),height:integer(w.height,'height',200,16384),fullscreen:w.fullscreen??false}}
 for(const key of ['icon','notes'])if(body[key]!==undefined){if(typeof body[key]!=='string'||body[key].length>10000)fail(key+'必须是字符串');out[key]=body[key]}
 return out
}
export function launchRequest(input:unknown):LaunchRequest {
 const b=object(input);keys(b,['instanceId','accountId','memoryMb','javaPath','extraJvmArgs','extraGameArgs','detach'])
 const out:LaunchRequest={instanceId:identifier(b.instanceId),accountId:string(b.accountId,'accountId（账号 id）')}
 if(b.memoryMb!==undefined)out.memoryMb=integer(b.memoryMb,'memoryMb',128,262144)
 if(b.javaPath!==undefined)out.javaPath=string(b.javaPath,'javaPath',4096)
 if(b.extraJvmArgs!==undefined)out.extraJvmArgs=strings(b.extraJvmArgs,'extraJvmArgs')
 if(b.extraGameArgs!==undefined)out.extraGameArgs=strings(b.extraGameArgs,'extraGameArgs')
 if(b.detach!==undefined){if(typeof b.detach!=='boolean')fail('detach必须是布尔值');out.detach=b.detach}
 return out
}
export function settingsPatch(input:unknown):Partial<Settings> {
 const b=object(input);keys(b,['language','dataDir','concurrency','mirrors','proxy','autoDownloadJava','keepLogs','showSnapshots','downloadSource','theme','curseforgeApiKey','microsoftClientId','microsoftAuthority','authlibInjectorMirror']);const out={...b}
 if(b.language!==undefined&&!['zh-CN','en-US'].includes(b.language))fail('不支持的语言')
 if(b.theme!==undefined&&!['archive','midnight','light'].includes(b.theme))fail('不支持的主题')
 if(b.downloadSource!==undefined&&!['official','mirror'].includes(b.downloadSource))fail('不支持的下载源')
 if(b.concurrency!==undefined)out.concurrency=integer(b.concurrency,'concurrency',1,64)
 if(b.keepLogs!==undefined)out.keepLogs=integer(b.keepLogs,'keepLogs',0,200)
 for(const key of ['showSnapshots','autoDownloadJava'])if(b[key]!==undefined&&typeof b[key]!=='boolean')fail(key+'必须是布尔值')
 for(const key of ['dataDir','curseforgeApiKey','microsoftClientId','microsoftAuthority','authlibInjectorMirror'])if(b[key]!==undefined&&b[key]!==null&&typeof b[key]!=='string')fail(key+'必须是字符串')
 if(b.mirrors!==undefined){const mirrors=object(b.mirrors);keys(mirrors,['versionManifest','launcherMeta','assets','maven','fabric','forge','neoforge','quilt','modrinth','curseforge']);for(const value of Object.values(mirrors)){if(typeof value!=='string')fail('镜像地址必须是字符串');let url:URL;try{url=new URL(value as string)}catch{fail('镜像地址不是合法 URL')}if(!['https:','http:'].includes(url!.protocol))fail('镜像地址必须为 http/https')}out.mirrors=mirrors}
 if(b.proxy!==undefined){const proxy=object(b.proxy);keys(proxy,['enabled','host','port','username','password']);if(typeof proxy.enabled!=='boolean'||typeof proxy.host!=='string')fail('代理配置无效');proxy.port=integer(proxy.port,'proxy.port',1,65535);for(const key of ['username','password'])if(proxy[key]!==undefined&&typeof proxy[key]!=='string')fail('代理凭据无效');out.proxy=proxy}
 return out as Partial<Settings>
}
export function marketQuery(input:unknown):Record<string,any>{
 const body=object(input);const source=body.source??'modrinth'
 if(!['modrinth','curseforge'].includes(source))fail('未知内容来源 source')
 if(body.projectType&&!['mod','resourcepack','shader','modpack','datapack','plugin'].includes(body.projectType))fail('未知内容类型 projectType')
 if(body.sort&&!['relevance','downloads','follows','updated','newest'].includes(body.sort))fail('未知排序 sort')
 return {...body,source,query:body.query??'',offset:integer(body.offset,'offset',0,100000,0),limit:integer(body.limit,'limit',1,100,20)}
}
export function marketInstallInput(input:unknown):Record<string,any>{
 const body=object(input),version=object(body.version),file=object(version.file)
 identifier(body.instanceId,'instanceId');string(version.id,'version.id');string(version.projectId,'projectId')
 if(!['modrinth','curseforge'].includes(version.source))fail('未知来源 source')
 const url=new URL(string(file.url,'file.url'));if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))fail('下载地址必须是HTTPS')
 string(file.fileName,'fileName')
 return body
}
