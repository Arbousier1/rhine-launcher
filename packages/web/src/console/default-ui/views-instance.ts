import {esc,formatDate,formatPlaytime,loaderLabel,accountKindLabel} from './dom'
import type {ShellApi} from './state'
import type {LauncherInstance} from '../launcher-state'
import type {JavaRuntime,SystemInfo} from './api'

export interface InstanceView{
 editing:string|null
 system:SystemInfo|null
 java:JavaRuntime[]
 javaError:string|null
 launchStage:{label:string;value:number}|null
 advice:string[]
}
/** HMCL-style launch states: the real work is reported, never a fake spinner. */
const LAUNCH_STAGES=['检测 Java 版本','登录账户','下载必要文件','等待游戏启动','启动完成']
export function launchStages(current:number){return LAUNCH_STAGES.map((label,i)=>({label,state:i<current?'done':i===current?'active':'todo'}))}

export function instanceList(api:ShellApi){
 const snapshot=api.snapshot(),query=api.state.filter.trim().toLowerCase()
 const instances=snapshot.instances.filter(instance=>!query||(instance.name+' '+instance.gameVersion+' '+loaderLabel(instance.loaders)).toLowerCase().includes(query))
 if(!instances.length)return '<p class="dft-empty">'+(snapshot.status==='loading'?'正在读取实例…':snapshot.instances.length?'没有匹配的实例。':'没有游戏实例。\n进入下载页安装一个游戏版本。')+'</p>'
 return '<ul class="dft-list">'+instances.map(instance=>{
  const running=snapshot.sessions.some(s=>s.instanceId===instance.id&&(s.status==='running'||s.status==='starting'))
  return '<li><button class="dft-item" data-select="'+esc(instance.id)+'" aria-current="'+(instance.id===api.state.selectedId)+'">'
   +'<b>'+esc(instance.name)+'</b><small>'+esc(instance.gameVersion)+' · '+esc(loaderLabel(instance.loaders))+(running?' · 运行中':'')+'</small></button></li>'
 }).join('')+'</ul>'
}

export function instanceMain(api:ShellApi,view:InstanceView){
 const snapshot=api.snapshot(),selected=snapshot.instances.find(i=>i.id===api.state.selectedId)??snapshot.instances[0]
 if(!selected)return emptyState()
 const account=snapshot.accounts.find(a=>a.id===snapshot.selectedAccountId)??snapshot.accounts[0]
 const running=snapshot.sessions.find(s=>s.instanceId===selected.id&&(s.status==='running'||s.status==='starting'))
 const pending=(snapshot.pending[selected.id]??[]).length>0||api.state.busy==='启动'
 const busy=view.launchStage!==null||pending
 const accountReady=Boolean(account)
 return '<div class="dft-hero"><div class="dft-hero-text"><h1>'+esc(selected.name)+'</h1>'
  +'<p>'+esc(selected.gameVersion)+' · '+esc(loaderLabel(selected.loaders))+' · '+esc(account?account.name+' · '+accountKindLabel(account.kind):'未选择账户')+'</p></div>'
  +launchButton(running,busy,accountReady,selected.id,selected.gameVersion,loaderLabel(selected.loaders))
  +'</div>'
  +(api.state.error?'<p class="dft-alert" role="alert">'+esc(api.state.error)+'</p>':'')
  +(view.advice.length?'<p class="dft-alert warn" role="status">'+esc(view.advice.join('\n'))+'</p>':'')
  +(view.launchStage?launchPanel(view.launchStage):'')
  +'<div class="dft-row"><button class="inline-button" data-action="edit" data-id="'+esc(selected.id)+'">修改实例</button>'
  +'<button class="inline-button" data-action="reveal" data-path="'+esc(selected.path??'')+'">打开文件夹</button>'
  +'<button class="inline-button" data-action="duplicate" data-id="'+esc(selected.id)+'">复制实例</button>'
  +'<button class="inline-button" data-action="delete" data-id="'+esc(selected.id)+'">删除实例</button></div>'
  +(view.editing===selected.id?editForm(selected,view):'')
  +overview(selected,account?.name,view)
  +tabs(api,selected)
}

type LauncherSessionLike={pid?:number}

function launchButton(running:LauncherSessionLike|undefined,busy:boolean,accountReady:boolean,id:string,version:string,loader:string){
 if(running)return '<button class="dft-launch" data-action="stop" data-id="'+esc(id)+'"><span>结束游戏</span><span>'+(running.pid?'PID '+running.pid:'正在运行')+'</span></button>'
 const caption=!accountReady?'请先在设置中添加账户':busy?'正在启动…':version+' · '+loader
 return '<button class="dft-launch" data-action="launch" data-id="'+esc(id)+'"'+(busy||!accountReady?' disabled':'')+'><span>启动游戏</span><span>'+esc(caption)+'</span></button>'
}

function launchPanel(stage:{label:string;value:number}){
 const current=stage.value>=1?LAUNCH_STAGES.length-1:Math.min(LAUNCH_STAGES.length-2,Math.floor(stage.value*LAUNCH_STAGES.length))
 return '<div class="dft-grid" style="grid-template-columns:1fr"><div><dt>正在启动</dt><dd>'+esc(stage.label)+'</dd>'
  +'<div class="dft-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(stage.value*100)+'"><i style="width:'+Math.round(stage.value*100)+'%"></i></div>'
  +'<div class="dft-row">'+launchStages(current).map(s=>'<span class="dft-step '+s.state+'"><i></i>'+esc(s.label)+'</span>').join('')+'</div></div></div>'
}

function editForm(instance:LauncherInstance,view:InstanceView){
 const javaOptions=view.java.length
  ?view.java.map(r=>'<option value="'+esc(r.path)+'"'+(instance.javaPath===r.path?' selected':'')+'>Java '+esc(r.version)+' · '+esc(r.vendor||'未知厂商')+' · '+esc(r.arch)+'</option>').join('')
  :'<option value="">未检测到 Java</option>'
 const total=view.system?.totalMemoryMb??0
 const maxMb=instance.memory?.maxMb??4096
 return '<div class="dft-fields">'
  +'<label>游戏实例名称<input data-edit-name value="'+esc(instance.name)+'" maxlength="120"></label>'
  +'<label>游戏分配内存（MB）<input data-edit-memory type="number" min="512" max="'+Math.max(1024,total||65536)+'" step="256" value="'+maxMb+'">'
  +(total?'<small>系统共 '+Math.round(total/1024)+' GB，建议不超过 '+Math.floor(total*0.7/1024)+' GB</small>':'')+'</label>'
  +'<label>游戏 Java<select data-edit-java>'+javaOptions+'</select>'+(view.javaError?'<small>'+esc(view.javaError)+'</small>':'<small>只列出检测到的运行时</small>')+'</label>'
  +'</div><div class="dft-row"><button class="solid-button" data-action="save-edit">保存</button><button class="inline-button" data-action="cancel-edit">取消</button></div>'
}

function overview(instance:LauncherInstance,accountName:string|undefined,view:InstanceView){
 return '<div class="dft-grid">'
  +'<div><dt>游戏版本</dt><dd>'+esc(instance.gameVersion)+'</dd></div>'
  +'<div><dt>加载器</dt><dd>'+esc(loaderLabel(instance.loaders))+'</dd></div>'
  +'<div><dt>内存分配</dt><dd>'+(instance.memory?instance.memory.minMb+'–'+instance.memory.maxMb+' MB':'默认')+'</dd></div>'
  +'<div><dt>登录账户</dt><dd>'+esc(accountName??'未选择')+'</dd></div>'
  +'<div><dt>上次启动</dt><dd>'+esc(formatDate(instance.lastLaunchedAt))+'</dd></div>'
  +'<div><dt>累计游玩</dt><dd>'+esc(formatPlaytime(instance.playTimeMs))+'</dd></div>'
  +'</div>'
  +(view.system?'<p class="dft-hint">系统：'+esc(view.system.platform)+' '+esc(view.system.arch)+' · '+esc(view.system.cpuModel)+'（'+view.system.cpuCount+' 线程）· 内存 '+Math.round(view.system.totalMemoryMb/1024)+' GB</p>':'')
}

function tabs(api:ShellApi,instance:LauncherInstance){
 const tab=api.state.detailTab
 const active=(tab==='mods'||tab==='log')?tab:'overview'
 const body=active==='mods'?modsPanel(api,instance):active==='log'?logPanel(api,instance)
  :'<p class="dft-hint">目录：'+esc(instance.path??'—')+'<br>Java：'+esc(instance.javaPath??'按版本自动选择')+(instance.notes?'<br>备注：'+esc(instance.notes):'')+'</p>'
 return '<div class="dft-tabs" role="tablist">'+([['overview','概览'],['mods','Mod 管理'],['log','运行日志']] as const)
  .map(([k,l])=>'<button role="tab" data-tab="'+k+'" aria-selected="'+(active===k)+'">'+l+'</button>').join('')+'</div><div role="tabpanel">'+body+'</div>'
}

function modsPanel(api:ShellApi,instance:LauncherInstance){
 const mods=api.snapshot().mods[instance.id]
 if(!mods)return '<p class="dft-hint">正在读取 Mod…</p>'
 if(!mods.length)return '<p class="dft-hint">该实例没有 Mod。</p>'
 return '<ul class="dft-rows">'+mods.slice(0,100).map(m=>'<li><span>'+esc(m.meta?.name??m.name)+'</span><small>'+(m.enabled?'启用':'禁用')+'</small></li>').join('')+'</ul>'
}

function logPanel(api:ShellApi,instance:LauncherInstance){
 const sessions=api.snapshot().sessions.filter(s=>s.instanceId===instance.id)
 if(!sessions.length)return '<p class="dft-hint">暂无启动记录。</p>'
 return '<ul class="dft-rows">'+sessions.slice(0,10).map(s=>'<li><span>'+esc(formatDate(s.startedAt))+'</span><small>'+esc(s.status)
  +(s.exitCode!==undefined&&s.exitCode!==null?' · 退出码 '+s.exitCode:'')+'</small></li>').join('')+'</ul>'
}

function emptyState(){
 return '<div class="dft-hero"><div class="dft-hero-text"><h1>还没有游戏实例</h1><p>安装一个 Minecraft 版本即可开始。</p></div>'
  +'<button class="dft-launch" data-shell-tab="downloads"><span>安装游戏</span><span>前往下载页</span></button></div>'
}
