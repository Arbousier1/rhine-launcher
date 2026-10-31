/** Launcher catalog semantics. Rendering/physics stay in the original RhineLab scene. */
export type CatalogMode = 'instances' | 'versions'
export type VersionChannel = 'release' | 'snapshot' | 'history'
export interface GameVersion { id:string;type:string;releaseTime?:string;time?:string;url?:string;name?:string }
export interface CatalogInstance {
 id:string;name:string;gameVersion:string;loaders?:{kind:string;version?:string}[];path?:string
 memory?:{minMb:number;maxMb:number};javaPath?:string;lastLaunchedAt?:number;playTimeMs?:number;createdAt?:number;notes?:string
}
export interface ArchiveRecord {
 id:string;key:string;kind:'instance'|'version'|'empty';title:string;en:string;department:string;category:string
 date:string;lead:string;clearance:string;abstract:string;findings:string[];source:string
 instanceId?:string;gameVersion?:string;loaderLabel?:string;instance?:CatalogInstance;version?:GameVersion;recommended?:boolean
}
export interface CatalogSelection {mode:CatalogMode;channel:VersionChannel;family:string;query:string}
export interface CatalogResult {records:ArchiveRecord[];columns:string[];total:number;filtered:number;families:string[]}
export function channelOf(version:GameVersion):VersionChannel {
 return version.type==='release'?'release':version.type==='snapshot'?'snapshot':'history'
}
export function versionFamily(version:GameVersion):string {
 const match=/^(\d+)\.(\d+)(?:\.|$)/.exec(version.id)
 if(match)return match[1]+'.'+match[2]+'.x'
 const snapshot=/^(\d{2})w/.exec(version.id)
 if(snapshot)return '20'+snapshot[1]+' 年快照'
 return version.type==='old_alpha'?'Alpha 历史版本':version.type==='old_beta'?'Beta 历史版本':'其他测试版本'
}
export function loaderLabel(instance:CatalogInstance):string {
 const loaders=(instance.loaders??[]).filter(item=>item.kind!=='vanilla')
 return loaders.length?loaders.map(item=>item.kind[0].toUpperCase()+item.kind.slice(1)+(item.version?' '+item.version:'')).join(' + '):'原版'
}
export function instanceGroup(instance:CatalogInstance):string {
 const first=instance.loaders?.find(item=>item.kind!=='vanilla')?.kind
 return first?first[0].toUpperCase()+first.slice(1):'原版实例'
}
export function displayDate(value:string|number|undefined):string {
 if(value===undefined)return '—'
 const date=new Date(value)
 if(Number.isNaN(date.getTime()))return '—'
 return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')
}
export function playTime(value=0):string {const mins=Math.floor(Math.max(0,value)/60000);return mins<60?mins+' 分钟':Math.floor(mins/60)+' 小时 '+mins%60+' 分钟'}
export function instanceRecord(instance:CatalogInstance,id:string):ArchiveRecord {
 const loader=loaderLabel(instance),memory=instance.memory?instance.memory.minMb+'–'+instance.memory.maxMb+' MB':'待配置'
 return {id,key:'instance:'+instance.id,kind:'instance',title:instance.name,en:'Minecraft '+instance.gameVersion,
  department:loader,category:instanceGroup(instance),date:displayDate(instance.lastLaunchedAt),lead:instance.path??'—',clearance:'已配置实例',
  abstract:instance.notes?.trim()||'独立保存模组、配置与存档。',
  findings:['游戏版本：'+instance.gameVersion,'加载器：'+loader,'内存：'+memory,'游玩时长：'+playTime(instance.playTimeMs),'实例目录：'+(instance.path??'—')],
  source:'',instanceId:instance.id,gameVersion:instance.gameVersion,loaderLabel:loader,instance}
}
export function versionRecord(version:GameVersion,id:string,recommended:boolean,instanceCount:number):ArchiveRecord {
 const channel=channelOf(version),kind=channel==='release'?'稳定版':channel==='snapshot'?'快照 / 测试版':'历史版本'
 return {id,key:'version:'+version.id,kind:'version',title:version.id,en:'Minecraft Java Edition',department:kind,category:versionFamily(version),
  date:displayDate(version.releaseTime??version.time),lead:instanceCount?instanceCount+' 个实例使用此版本':'尚未创建实例',
  clearance:recommended?'最新稳定版':channel==='snapshot'?'测试内容 · 请先备份世界':kind,
  abstract:channel==='release'?'选择加载器后创建独立实例。':channel==='snapshot'?'测试版：打开旧存档前请备份，建议使用独立实例。':'旧版本可能需要较早的 Java。',
  findings:['版本系列：'+versionFamily(version),'发布渠道：'+kind,'发布日期：'+displayDate(version.releaseTime??version.time),'加载器与 Java 要求会在此档案内按需查询，不猜测兼容性。'],
  source:'https://www.minecraft.net/en-us/updates',gameVersion:version.id,loaderLabel:kind,version,recommended}
}
export function emptyRecord(mode:CatalogMode,status:'loading'|'ready'|'error',error?:string,filtered=false):ArchiveRecord {
 const title=status==='loading'?'正在读取目录':status==='error'?'目录暂时不可用':filtered?'没有匹配的档案':mode==='instances'?'还没有游戏实例':'没有可用版本'
 return {id:'X-000',key:'empty:'+mode,kind:'empty',title,en:mode==='instances'?'MY INSTANCES':'VERSION CATALOG',department:'',category:'空目录',date:'—',lead:'',clearance:status==='error'?'连接错误':'无选中项',
  abstract:error??(filtered?'清除检索条件或切换版本系列。':mode==='instances'?'选择一个版本，创建你的第一个实例。':'暂时没有可用版本，请重试。'),findings:[],source:''}
}
export function buildCatalog(instances:readonly CatalogInstance[],versions:readonly GameVersion[],selection:CatalogSelection,idFor:(key:string)=>string):CatalogResult {
 const needle=selection.query.trim().toLocaleLowerCase()
 if(selection.mode==='instances'){
  const records=instances.filter(instance=>!needle||[instance.name,instance.gameVersion,loaderLabel(instance)].join(' ').toLocaleLowerCase().includes(needle)).map(instance=>instanceRecord(instance,idFor('instance:'+instance.id)))
  return {records,columns:[...new Set(records.map(record=>record.category))],total:instances.length,filtered:records.length,families:[]}
 }
 const channelVersions=versions.filter(version=>channelOf(version)===selection.channel)
 const families=[...new Set(channelVersions.map(versionFamily))]
 const recommended=versions.find(version=>version.type==='release')?.id
 const selected=channelVersions.filter(version=>(!selection.family||versionFamily(version)===selection.family)&&(!needle||[version.id,versionFamily(version),version.name??''].join(' ').toLocaleLowerCase().includes(needle)))
 const counts=new Map<string,number>();for(const instance of instances)counts.set(instance.gameVersion,(counts.get(instance.gameVersion)??0)+1)
 const records=selected.map(version=>versionRecord(version,idFor('version:'+version.id),version.id===recommended,counts.get(version.id)??0))
 return {records,columns:[...new Set(records.map(record=>record.category))],total:channelVersions.length,filtered:records.length,families}
}
/** Bounded tick window, centred near the selected item; never 1000 tiny buttons. */
export function tickWindow(files:readonly number[],selected:number,limit=8):number[]{
 const local=Math.max(0,files.indexOf(selected)),offset=Math.min(Math.max(0,local-Math.floor(limit/2)),Math.max(0,files.length-limit))
 return files.slice(offset,offset+limit)
}
