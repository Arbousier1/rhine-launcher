/** Native detail composition; show decision-relevant information once. */
import {escapeHtml as esc} from './html'
import {channelOf,displayDate,playTime,type ArchiveRecord} from './catalog-model'
export interface VersionDraft {name:string;loader:string;loaderVersion:string;memoryMb:number}
export interface VersionInspection {loading:boolean;java?:number;error?:string;loaderLoading?:boolean;loaderError?:string;builds?:{version:string;stable?:boolean}[]}
export interface DetailContext {
 accounts:{id:string;name:string;kind:string}[];selectedAccountId:string|null
 pending:boolean;running:boolean;status:string;error?:string;mods?:number;modsError?:string
 draft?:VersionDraft;inspection?:VersionInspection
}
const attr=(value:unknown)=>esc(String(value??''))
function meta(label:string,value:string){return '<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>'}
function tabs(labels:string[]){return '<div class="detail-tabs" role="tablist">'+labels.map((text,i)=>'<button id="tab-'+['overview','notes','history'][i]+'" class="'+(i===0?'active':'')+'" role="tab" aria-controls="tab-panel" aria-selected="'+(i===0)+'" data-tab="'+['overview','notes','history'][i]+'">0'+(i+1)+' <span>'+text+'</span></button>').join('')+'<i class="tab-indicator" aria-hidden="true"></i></div><div id="tab-panel" class="tab-panel" role="tabpanel"></div>'}
export function launchActionLabel(ctx:Pick<DetailContext,'pending'|'running'|'accounts'>):string{return ctx.pending?(ctx.running?'停止中…':'准备中…'):ctx.running?'停止游戏':ctx.accounts.length?'启动游戏':'添加账号'}
export function launcherDetailMarkup(record:ArchiveRecord,ctx:DetailContext):string{
 if(record.kind==='empty')return '<h2>'+esc(record.title)+'</h2><p class="launcher-explanation">'+esc(record.abstract)+'</p><div class="detail-actions"><button class="solid-button" data-action="browse-versions"><span>选择版本</span><span aria-hidden="true">→</span></button></div>'
 const isInstance=record.kind==='instance',title=isInstance?record.title:'Minecraft '+record.gameVersion
 let html='<div class="detail-kicker"><span>'+(isInstance?'实例':'安装版本')+'</span><span data-live-state>'+esc(isInstance?ctx.status:record.recommended?'最新稳定版':record.department)+'</span></div><h2>'+esc(title)+'</h2><div class="detail-rule"></div>'
 if(isInstance){
  const instance=record.instance!
  html+='<dl class="metadata">'+meta('游戏版本',instance.gameVersion)+meta('加载器',record.loaderLabel??'原版')+meta('内存',(instance.memory?.minMb??512)+'–'+(instance.memory?.maxMb??2048)+' MB')+'<div class="launcher-account-cell"><dt>启动账号</dt><dd><select id="launcher-account-select" aria-label="用于启动的账号">'+(ctx.accounts.length?ctx.accounts.map(account=>'<option value="'+attr(account.id)+'"'+(account.id===ctx.selectedAccountId?' selected':'')+'>'+esc(account.name)+' · '+(account.kind==='offline'?'离线':account.kind==='microsoft'?'Microsoft':'外置')+'</option>').join(''):'<option value="">请先添加账号</option>')+'</select><button class="inline-button" data-action="account-settings" aria-label="管理启动账号">管理 ↗</button></dd></div></dl>'
  html+='<div class="detail-actions launcher-primary-actions"><button class="solid-button" data-main-action data-action="'+(ctx.running?'stop':'launch')+'"'+(ctx.pending?' disabled aria-busy="true"':'')+'><span data-action-label>'+launchActionLabel(ctx)+'</span><span aria-hidden="true">→</span></button><button class="export-button" data-action="reveal-instance">打开目录 ↗</button></div>'
  html+='<p class="launcher-action-feedback" data-launch-feedback role="status">'+esc(ctx.error??(ctx.pending?'正在检查启动环境…':''))+'</p>'
  html+=tabs(['概览','模组','记录'])
  html+='<div class="detail-actions launcher-secondary-actions"><button class="export-button" data-action="bookmark">收藏 ＋</button></div>'
 }else{
  const draft=ctx.draft!,inspection=ctx.inspection!,channel=record.version?channelOf(record.version):'release'
  html+='<dl class="metadata">'+meta('发布日期',record.date)+meta('运行时',inspection.loading?'读取中…':inspection.error?'读取失败':inspection.java?'Java '+inspection.java:'自动选择')+'</dl>'
  if(channel==='snapshot')html+='<p class="launcher-explanation">测试版：打开旧存档前请备份。</p>'
  if(channel==='history')html+='<p class="launcher-explanation">旧版本可能需要较早的 Java。</p>'
  html+='<div class="launcher-fields"><label><span>实例名称</span><input id="instance-name" value="'+attr(draft.name)+'" maxlength="120" placeholder="为实例命名" /></label><label><span>内存上限（MB）</span><input id="instance-memory" type="number" min="512" max="262144" step="256" value="'+draft.memoryMb+'" /></label><label><span>加载器</span><select id="instance-loader">'+['vanilla','fabric','quilt','forge','neoforge','optifine'].map(kind=>'<option value="'+kind+'"'+(draft.loader===kind?' selected':'')+'>'+(kind==='vanilla'?'原版':kind[0].toUpperCase()+kind.slice(1))+'</option>').join('')+'</select></label><label'+(draft.loader==='vanilla'?' hidden':'')+'><span>加载器版本</span><select id="instance-loader-version"'+(draft.loader==='vanilla'||inspection.loaderLoading?' disabled':'')+'>'+ (draft.loader==='vanilla'?'<option>无需选择</option>':inspection.loaderLoading?'<option value="">查询中…</option>':!inspection.builds?.length?'<option value="">'+esc(inspection.loaderError??'没有兼容版本')+'</option>':inspection.builds.map(build=>'<option value="'+attr(build.version)+'"'+(draft.loaderVersion===build.version?' selected':'')+'>'+esc(build.version)+(build.stable===false?' · 测试版':'')+'</option>').join(''))+'</select></label></div>'
  const allowed=!ctx.pending&&!inspection.loading&&!inspection.error&&(draft.loader==='vanilla'||Boolean(draft.loaderVersion)&&!inspection.loaderLoading&&!inspection.loaderError)
  html+='<p class="launcher-action-feedback" data-launch-feedback role="status">'+esc(ctx.error??inspection.error??inspection.loaderError??'')+'</p><div class="detail-actions"><button class="solid-button" data-action="create-install" title="创建独立实例，不覆盖现有存档"'+(!allowed?' disabled':'')+'><span>'+(ctx.pending?'创建中…':'创建并安装')+'</span><span aria-hidden="true">→</span></button><button class="export-button" data-action="inspect-retry"'+(ctx.error||inspection.error||inspection.loaderError?'':' hidden')+'>重试 ↻</button></div>'
 }
 return html
}
export function instanceOverview(record:ArchiveRecord,ctx:DetailContext):string{
 const instance=record.instance
 if(!instance)return '<p>'+esc(record.abstract)+'</p>'
 return (instance.notes?.trim()?'<p>'+esc(instance.notes.trim())+'</p>':'')+'<dl class="launcher-overview">'+meta('模组',ctx.mods===undefined?(ctx.modsError?'读取失败：'+ctx.modsError:'读取中…'):ctx.mods+' 个')+(instance.lastLaunchedAt?meta('上次启动',displayDate(instance.lastLaunchedAt)):'')+((instance.playTimeMs??0)>=60000?meta('游玩时长',playTime(instance.playTimeMs)):'')+'</dl><details class="launcher-advanced"><summary>位置与运行时</summary><dl class="launcher-overview">'+meta('实例目录',instance.path??'—')+meta('Java',instance.javaPath??'自动选择')+'</dl></details>'
}
