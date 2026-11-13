import {defineFeature} from '@rhine/plugin-api'
import {getLauncherSnapshot} from '../../launcher-bridge'
import {createInstance} from '../../launcher-bridge'
import {getVersions,getLoaderVersions,installVersion,waitForTask} from '../catalog'
import {esc} from '../dom'
import {createDownloadState,versionList,downloadsMain,type DownloadState} from '../downloads'
import {shellApi} from '../shell-state'
import {mountSurface,type SurfaceHandle,type SurfaceInput} from './shared'
import {contributeSurface} from '../slots'

/** Download surface: version list, component cards and a real install task. */
export default defineFeature<SurfaceInput,SurfaceHandle>({
 id:'surface.downloads',capability:'surface.downloads',title:'下载页面（版本、组件与安装任务）',
 optionalDepends:['launcher.versions.list','launcher.loader.versions','launcher.version.install','launcher.loader.install','launcher.task.wait','launcher.task.cancel','launcher.instance.create','launcher.bootstrap'],
 setup(env){contributeSurface(env,{capability:'surface.downloads',labelKey:'nav.downloads',order:20})},
 execute(input,env){
  env.signal.throwIfAborted()
  const download:DownloadState=createDownloadState()
  return mountSurface(env,input,(rerender,signal)=>{
   const api=shellApi(env,rerender,signal)
   const loadVersions=async()=>{download.loading=true;download.error=null;rerender()
    try{const versions=await getVersions(signal)
     download.versions=versions.filter(v=>api.state.versionChannel==='release'?v.type==='release':api.state.versionChannel==='snapshot'?v.type==='snapshot':!['release','snapshot'].includes(v.type))}
    catch(error){if(!signal.aborted)download.error=error instanceof Error?error.message:String(error)}
    finally{download.loading=false;rerender()}}
   const loadBuilds=async(version:string,loader:string)=>{download.building=true;download.buildError=null;download.builds=[];rerender()
    try{const builds=await getLoaderVersions(loader,version,signal)
     download.builds=builds;download.loaderVersion=builds[0]?.version??''
     if(!builds.length)download.buildError='没有与 '+version+' 兼容的 '+loader+' 版本'}
    catch(error){if(!signal.aborted)download.buildError=error instanceof Error?error.message:String(error)}
    finally{download.building=false;rerender()}}
   const install=async()=>{const version=api.state.selectedVersion;if(!version||download.installing)return
    download.installError=null;download.installing=true;download.stage={label:'正在准备安装…',value:0.05};rerender()
    try{await api.act('安装',async()=>{
     const taskId=await installVersion(version,download.loader,download.loaderVersion,signal)
     download.stage={label:'正在下载游戏文件…',value:0.2};rerender()
     await waitForTask(taskId,signal,text=>{download.stage={label:text,value:0.6};rerender()})
     download.stage={label:'正在创建实例…',value:0.9};rerender()
     const instance=await createInstance({name:download.name||('Minecraft '+version),gameVersion:version,
      loaders:download.loader==='vanilla'?[]:[{kind:download.loader as never,version:download.loaderVersion}],
      memory:{minMb:1024,maxMb:download.memoryMb}})
     await api.reload();api.state.tab='instances';api.state.selectedId=instance.id
     input.notify?.('安装完成：'+instance.name)})}
    catch(error){download.installError=error instanceof Error?error.message:String(error)}
    finally{download.installing=false;download.stage=null;rerender()}}
   input.root.addEventListener('click',(event:Event)=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button||!input.root.contains(button))return
    if(button.dataset.channel){api.state.versionChannel=button.dataset.channel as never;api.state.selectedVersion=null;void loadVersions();return}
    if(button.dataset.version){const v=button.dataset.version;api.state.selectedVersion=v;download.name='Minecraft '+v;download.builds=[];download.loaderVersion='';download.installError=null
     if(download.loader!=='vanilla')void loadBuilds(v,download.loader);rerender();return}
    if(button.dataset.loader){download.loader=button.dataset.loader;download.builds=[];download.loaderVersion=''
     if(download.loader!=='vanilla'&&api.state.selectedVersion)void loadBuilds(api.state.selectedVersion,download.loader);rerender();return}
    if(button.dataset.action==='install'){void install();return}
   },{signal})
   input.root.addEventListener('input',(event:Event)=>{
    const target=event.target as HTMLInputElement
    if(target.dataset.name!==undefined)download.name=target.value
    if(target.dataset.memory!==undefined)download.memoryMb=Number(target.value)||4096
   },{signal})
   input.root.addEventListener('change',(event:Event)=>{
    const target=event.target as HTMLSelectElement
    if(target.dataset.build!==undefined){download.loaderVersion=target.value;rerender()}
   },{signal})
   if(!download.versions.length)void loadVersions()
   input.root.innerHTML=versionList(api,download)+'<div class="dft-main-body">'+downloadsMain(api,download)+'</div>'
  })
 }
})
