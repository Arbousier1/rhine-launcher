import {esc} from './dom'
import type {ShellApi} from './state'
import type {GameVersion} from '../catalog-model'
const channels=[['release','正式版'],['snapshot','快照'],['history','远古版']] as const
export interface DownloadState{
 versions:GameVersion[];loading:boolean;error:string|null
 builds:{version:string;stable?:boolean}[];building:boolean;buildError:string|null
 name:string;memoryMb:number;loader:string;loaderVersion:string
 installing:boolean;stage:{label:string;value:number}|null;installError:string|null
}
export function createDownloadState():DownloadState{return {versions:[],loading:false,error:null,builds:[],building:false,buildError:null,name:'',memoryMb:4096,loader:'vanilla',loaderVersion:'',installing:false,stage:null,installError:null}}
export const LOADERS:[string,string][]=[['vanilla','原版'],['fabric','Fabric'],['quilt','Quilt'],['forge','Forge'],['neoforge','NeoForge'],['optifine','OptiFine']]

export function versionList(api:ShellApi,download:DownloadState){
 if(download.loading)return '<p class="dft-empty">正在获取版本列表…</p>'
 if(download.error)return '<p class="dft-alert" role="alert">'+esc(download.error)+'</p>'
 const selected=api.state.selectedVersion
 return '<div class="dft-side-head" style="padding-left:0"><b>版本类型</b></div>'
  +'<div style="display:flex;gap:4px;margin-bottom:8px">'+channels.map(([v,l])=>'<button class="inline-button" data-channel="'+v+'" aria-pressed="'+(api.state.versionChannel===v)+'">'+l+'</button>').join('')+'</div>'
  +'<ul class="dft-list" style="padding-left:0">'+download.versions.map(v=>'<li><button class="dft-item" data-version="'+esc(v.id)+'" aria-current="'+(selected===v.id)+'">'
  +'<b>'+esc(v.id)+'</b><small>'+esc(v.type==='release'?'正式版':v.type==='snapshot'?'快照':'远古版')+(v.releaseTime?' · '+esc(v.releaseTime.slice(0,10)):'')+'</small></button></li>').join('')+'</ul>'
}

/** PCL2-style component cards: pick Minecraft on the left, then a loader component. */
export function downloadsMain(api:ShellApi,download:DownloadState){
 const version=api.state.selectedVersion
 if(!version)return '<div class="dft-hero"><div class="dft-hero-text"><h1>下载游戏</h1><p>先在左侧选择一个 Minecraft 版本。</p></div></div>'
 const loader=download.loader
 const loaderCard=(v:string,l:string,detail:string)=>'<button class="dft-card" data-loader="'+v+'" aria-pressed="'+(loader===v)+'"><span><b>'+l+'</b><small>'+detail+'</small></span></button>'
 return '<div class="dft-hero"><div class="dft-hero-text"><h1>Minecraft '+esc(version)+'</h1><p>选择组件后开始下载，安装为独立实例。</p></div></div>'
  +(download.installError?'<p class="dft-alert" role="alert">'+esc(download.installError)+'</p>':'')
  +'<div class="dft-side-head" style="padding-left:0"><b>游戏组件</b></div>'
  +'<div class="dft-cards">'+LOADERS.map(([v,l])=>loaderCard(v,l,
    v==='vanilla'?'不安装加载器'
    :loader===v&&download.building?'正在读取版本…'
    :loader===v&&download.buildError?'读取失败'
    :loader===v&&download.loaderVersion?download.loaderVersion
    :'点击选择')).join('')+'</div>'
  +(loader!=='vanilla'&&loader!=='optifine'?
    (download.buildError?'<p class="dft-alert" role="alert">'+esc(download.buildError)+'</p>'
    :'<div class="dft-fields"><label>'+esc(loader)+' 版本<select data-build'+(download.building||!download.builds.length?' disabled':'')+'>'
      +(download.building?'<option>读取中…</option>':download.builds.length?download.builds.map(b=>'<option value="'+esc(b.version)+'"'+(download.loaderVersion===b.version?' selected':'')+'>'+esc(b.version)+(b.stable===false?'（测试版）':'')+'</option>').join(''):'<option value="">没有兼容版本</option>')
      +'</select><small>只显示与 '+esc(version)+' 兼容的构建</small></label></div>')
    :loader==='optifine'?'<p class="dft-alert warn">OptiFine 与一部分 Mod 的兼容性不佳，请谨慎安装。</p>':'')
  +'<div class="dft-fields"><label>游戏实例名称<input data-name value="'+esc(download.name||('Minecraft '+version))+'" maxlength="120"></label>'
  +'<label>游戏分配内存（MB）<input data-memory type="number" min="512" max="65536" step="256" value="'+download.memoryMb+'"></label></div>'
  +(download.stage?installingPanel(download.stage):'')
  +'<div class="dft-row"><button class="dft-launch" data-action="install"'+(download.installing?' disabled':'')+'><span>开始下载</span><span>'+esc(download.installing?'正在安装…':'创建实例并安装 '+version)+'</span></button></div>'
}
function installingPanel(stage:{label:string;value:number}){
 return '<div class="dft-grid" style="grid-template-columns:1fr"><div><dt>安装进度</dt><dd>'+esc(stage.label)+'</dd>'
  +'<div class="dft-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(stage.value*100)+'"><i style="width:'+Math.round(stage.value*100)+'%"></i></div></div></div>'
}
