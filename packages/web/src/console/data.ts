/** Live catalog adapter. Keeps the original scene exports; does not alter camera or motion. */
import {launcherInstances,subscribeInstances} from './launcher-bridge'
import {createCatalogIndex} from './catalog-index'
import {buildCatalog,emptyRecord,type ArchiveRecord,type GameVersion,type CatalogMode,type VersionChannel,type CatalogSelection} from './catalog-model'
export type {ArchiveRecord} from './catalog-model'
export const records:ArchiveRecord[]=[emptyRecord('instances','loading')]
export const archiveColumns:string[]=['空目录']
export const categories:string[]=['全部档案','空目录']
let catalogIndex=createCatalogIndex(records,archiveColumns)
const identities=new Map<string,string>();let serial=0
const listeners=new Set<()=>void>()
let versions:GameVersion[]=[]
let selection:CatalogSelection={mode:'instances',channel:'release',family:'',query:''}
let instancesReady=false,instanceError='',versionStatus:'loading'|'ready'|'error'='loading',versionError=''
let total=0,filtered=0,families:string[]=[]
function idFor(key:string):string{if(!identities.has(key))identities.set(key,'X-'+String(++serial).padStart(3,'0'));return identities.get(key)!}
function rebuild():void{
 const result=buildCatalog(launcherInstances(),versions,selection,idFor)
 total=result.total;filtered=result.filtered;families=result.families
 const status=selection.mode==='instances'?(instanceError?'error':instancesReady?'ready':'loading'):versionStatus
 const shown=result.records.length?result.records:[emptyRecord(selection.mode,status,(selection.mode==='instances'?instanceError:versionError)||undefined,Boolean(selection.query||selection.family))]
 records.splice(0,records.length,...shown)
 archiveColumns.splice(0,archiveColumns.length,...(result.columns.length?result.columns:['空目录']))
 categories.splice(0,categories.length,'全部档案',...archiveColumns)
 catalogIndex=createCatalogIndex(records,archiveColumns)
 for(const listener of [...listeners])listener()
}
export function catalogState(){return {...selection,total,filtered,families:[...families],versionStatus,versionError}}
export function setCatalogMode(mode:CatalogMode){selection={...selection,mode,query:'',family:''};rebuild()}
export function filterVersions(channel:VersionChannel,family=''){selection={...selection,channel,family};rebuild()}
export function setCatalogQuery(query:string){selection={...selection,query};rebuild()}
export function setVersionCatalog(next:GameVersion[]){versions=next;versionStatus='ready';versionError='';rebuild()}
export function setVersionLoading(){versionStatus='loading';versionError='';rebuild()}
export function setVersionError(message:string){versionStatus='error';versionError=message;rebuild()}
export function subscribeCatalog(listener:()=>void):()=>void{listeners.add(listener);return()=>listeners.delete(listener)}
export function columnFiles(lane:number):number[]{return catalogIndex.column(lane)}
export function fileLocation(index:number){return catalogIndex.location(index)}
export function fileAtSlot(slot:number){const files=columnFiles(Math.floor(slot/32));return files[Math.max(0,Math.min(files.length-1,(slot%32)-12))]??0}
let uninstall:(()=>void)|undefined
export function installLauncherData():()=>void{
 if(uninstall)return()=>{}
 instancesReady=launcherInstances().length>0
 rebuild()
 const release=subscribeInstances(()=>{instancesReady=true;rebuild()})
 uninstall=()=>{release();uninstall=undefined}
 return uninstall
}
export function markInstancesReady(){instancesReady=true;instanceError='';rebuild()}
export function setInstanceCatalogError(message:string){instanceError=message;rebuild()}
