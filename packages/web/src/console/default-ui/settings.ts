import {esc,accountKindLabel} from './dom'
import type {ShellApi} from './state'
import type {JavaRuntime,SystemInfo} from './api'
export interface SettingsState{
 offlineName:string
 busy:string|null;message:string|null;error:string|null
 java:JavaRuntime[];javaLoading:boolean;javaError:string|null
 system:SystemInfo|null
 settings:Record<string,unknown>|null
}
export function createSettingsState():SettingsState{return {offlineName:'',busy:null,message:null,error:null,java:[],javaLoading:false,javaError:null,system:null,settings:null}}
export function settingsMain(api:ShellApi,state:SettingsState){
 const snapshot=api.snapshot(),app=snapshot.app
 const tab=api.state.detailTab==='overview'?'account':api.state.detailTab
 return '<div class="dft-hero"><div class="dft-hero-text"><h1>设置</h1><p>账户、Java、下载源与系统信息。</p></div></div>'
  +(state.error?'<p class="dft-alert" role="alert">'+esc(state.error)+'</p>':'')
  +(state.message?'<p class="dft-hint" role="status">'+esc(state.message)+'</p>':'')
  +'<div class="dft-tabs" role="tablist">'+([['account','账户'],['java','Java'],['global','全局'],['about','关于']] as const).map(([k,l])=>'<button role="tab" data-settings-tab="'+k+'" aria-selected="'+(tab===k)+'">'+l+'</button>').join('')+'</div>'
  +(tab==='java'?javaPanel(state):tab==='global'?globalPanel(state):tab==='about'?aboutPanel(state,app):accountPanel(api,state))
}
function accountPanel(api:ShellApi,state:SettingsState){
 const snapshot=api.snapshot()
 return '<div class="dft-side-head" style="padding-left:0"><b>账户列表</b></div>'
  +(snapshot.accounts.length?'<ul class="dft-rows">'+snapshot.accounts.map(a=>'<li><span>'+esc(a.name)+' · '+esc(accountKindLabel(a.kind))+(a.id===snapshot.selectedAccountId?'（当前）':'')+'</span>'
   +(a.id===snapshot.selectedAccountId?'':'<button class="inline-button" data-account-select="'+esc(a.id)+'">设为当前</button>')+'</li>').join('')+'</ul>'
   :'<p class="dft-empty">没有账户</p>')
  +'<div class="dft-fields"><label>离线用户名<input data-offline-name value="'+esc(state.offlineName)+'" maxlength="16" placeholder="Steve"><small>1–16 位字母、数字或下划线</small></label></div>'
  +'<div class="dft-row"><button class="solid-button" data-action="add-offline">添加离线账户</button>'
  +'<button class="inline-button" data-action="account-microsoft">添加微软账户</button>'
  +'<button class="inline-button" data-action="account-external">添加外置登录</button></div>'
  +'<p class="dft-hint">微软与外置登录需要真实凭据；启动器不会保存密码，也不会借用他人的应用身份。</p>'
}
function javaPanel(state:SettingsState){
 const javaDir=state.settings?.javaDir
 return '<div class="dft-side-head" style="padding-left:0"><b>检测到的 Java</b></div>'
  +(state.javaLoading?'<p class="dft-hint">正在检测…</p>':state.javaError?'<p class="dft-alert" role="alert">'+esc(state.javaError)+'</p>'
   :state.java.length?'<ul class="dft-rows">'+state.java.map(r=>'<li><span>Java '+esc(r.version)+' · '+esc(r.vendor||'未知厂商')+' · '+esc(r.arch)+(r.managed?' · 启动器管理':'')+'</span><small>'+esc(r.path)+'</small></li>').join('')+'</ul>'
   :'<p class="dft-empty">未检测到 Java。启动游戏前需要可用的 Java 运行时。</p>')
  +'<div class="dft-row"><button class="inline-button" data-action="scan-java">重新检测 Java</button>'
  +(javaDir?'<button class="inline-button" data-action="reveal" data-path="'+esc(String(javaDir))+'">打开 Java 目录</button>':'')+'</div>'
}
function globalPanel(state:SettingsState){
 const s=state.settings??{},mirrors=(s.mirrors??{}) as Record<string,string>
 return '<div class="dft-grid"><div><dt>下载源</dt><dd>'+esc(String(s.downloadSource??'official')==='official'?'官方':'镜像')+'</dd></div>'
  +'<div><dt>自动下载 Java</dt><dd>'+(s.autoDownloadJava===false?'关闭':'开启')+'</dd></div>'
  +'<div><dt>保留日志数</dt><dd>'+esc(String(s.keepLogs??'—'))+'</dd></div>'
  +'<div><dt>并发下载</dt><dd>'+esc(String(s.concurrency??'—'))+'</dd></div></div>'
  +'<p class="dft-hint">版本清单：'+esc(mirrors.versionManifest??'—')+'<br>Maven 镜像：'+esc(mirrors.maven??'—')+'</p>'
  +'<div class="dft-fields"><label>下载源<select data-setting="downloadSource"><option value="official"'+(s.downloadSource!=='mirror'?' selected':'')+'>官方</option><option value="mirror"'+(s.downloadSource==='mirror'?' selected':'')+'>镜像</option></select></label>'
  +'<label>自动下载 Java<select data-setting="autoDownloadJava"><option value="true"'+(s.autoDownloadJava!==false?' selected':'')+'>开启</option><option value="false"'+(s.autoDownloadJava===false?' selected':'')+'>关闭</option></select></label></div>'
}
function aboutPanel(state:SettingsState,app:unknown){
 const info=app as {name?:string;version?:string;platform?:string}|null
 const paths=(state.settings?.dataDir as string|undefined)??null
 return '<div class="dft-grid"><div><dt>启动器</dt><dd>'+esc(info?.name??'Rhine Launcher')+'</dd></div>'
  +'<div><dt>版本</dt><dd>'+esc(info?.version??'—')+'</dd></div>'
  +'<div><dt>平台</dt><dd>'+esc(info?.platform??'—')+'</dd></div>'
  +(state.system?'<div><dt>处理器</dt><dd>'+esc(state.system.cpuModel)+'</dd></div><div><dt>系统内存</dt><dd>'+Math.round(state.system.totalMemoryMb/1024)+' GB</dd></div><div><dt>线程</dt><dd>'+state.system.cpuCount+'</dd></div>':'')
  +(paths?'<div><dt>数据目录</dt><dd>'+esc(paths)+'</dd></div>':'')+'</div>'
}
