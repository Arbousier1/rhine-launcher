import {defineFeature} from '@rhine/plugin-api'
import {launchInstance,stopInstance,deleteInstance,revealPath,updateInstance,getLauncherSnapshot} from '../../launcher-bridge'
import {duplicateInstance,readSystemInfo,readJavaRuntimes} from '../api'
import {instanceList,instanceMain,type InstanceView} from '../views-instance'
import {shellApi} from '../shell-state'
import {mountSurface,type SurfaceHandle,type SurfaceInput} from './shared'
import {contributeSurface} from '../slots'

/** Instance surface: the only place that renders instances and starts games. */
export default defineFeature<SurfaceInput,SurfaceHandle>({
 id:'surface.instances',capability:'surface.instances',title:'游戏实例页面（列表、启动与实例设置）',
 optionalDepends:['launcher.bootstrap','launcher.events.connect','launcher.launch.start','launcher.session.stop','launcher.instance.delete','launcher.instance.update','launcher.mods.list','launcher.system.reveal'],
 setup(env){contributeSurface(env,{capability:'surface.instances',labelKey:'nav.instances',order:10})},
 execute(input,env){
  env.signal.throwIfAborted()
  const view:InstanceView={editing:null,system:null,java:[],javaError:null,launchStage:null,advice:[]}
  return mountSurface(env,input,(rerender,signal)=>{
   const api=shellApi(env,rerender,signal)
   const advice=()=>{view.advice=[];const snapshot=getLauncherSnapshot(),instance=snapshot.instances.find(i=>i.id===api.state.selectedId);if(!instance)return
    const total=view.system?.totalMemoryMb??0,max=instance.memory?.maxMb??0
    if(total&&max>total)view.advice.push('内存分配 '+max+' MB 超过系统内存 '+Math.round(total/1024)+' GB，游戏可能无法启动。')
    else if(total&&max>total*0.8)view.advice.push('内存分配接近系统上限，建议留出余量给系统与其他程序。')
    if(!snapshot.accounts.length)view.advice.push('还没有账户，请先在设置中添加。')}
   if(!view.system)void Promise.all([readSystemInfo(env,signal),readJavaRuntimes(env,signal)])
    .then(([info,java])=>{view.system=info;view.java=java;advice();rerender()})
    .catch(()=>{view.javaError='无法读取系统或 Java 信息'})
   const launch=async(id:string)=>{view.launchStage={label:'正在准备启动…',value:0.08};rerender()
    try{await api.act('启动',async()=>{const session=await launchInstance(id);view.launchStage={label:'等待游戏启动…',value:0.7};rerender()
      const deadline=Date.now()+20000
      while(Date.now()<deadline){const current=getLauncherSnapshot().sessions.find(s=>s.id===session.id)
       if(current?.status==='running'){view.launchStage={label:'游戏已启动'+(current.pid?'（PID '+current.pid+'）':''),value:1};break}
       if(current?.status==='crashed')throw new Error('游戏未能保持运行，请查看运行日志')
       await new Promise(r=>setTimeout(r,400))}
      input.notify?.('游戏已启动')})}
    finally{setTimeout(()=>{view.launchStage=null;rerender()},1200)}}
   input.root.addEventListener('click',(event:Event)=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button||!input.root.contains(button))return
    const action=button.dataset.action,id=button.dataset.id
    if(button.dataset.select){api.select(button.dataset.select);advice();return}
    if(button.dataset.tab){api.state.detailTab=button.dataset.tab as never;rerender();return}
    if(button.dataset.shellTab){api.state.tab=button.dataset.shellTab as never;rerender();return}
    if(action==='refresh'){void api.act('刷新',async()=>{await api.reload();advice();rerender()});return}
    if(action==='launch'&&id){void launch(id);return}
    if(action==='stop'&&id){const session=getLauncherSnapshot().sessions.find(s=>s.instanceId===id&&(s.status==='running'||s.status==='starting'));if(session)void api.act('结束游戏',async()=>{await stopInstance(session.id)});return}
    if(action==='reveal'){const path=button.dataset.path;if(path)void api.act('打开文件夹',async()=>{await revealPath(path)});return}
    if(action==='edit'){view.editing=id??null;rerender();return}
    if(action==='cancel-edit'){view.editing=null;rerender();return}
    if(action==='save-edit'){const name=(input.root.querySelector<HTMLInputElement>('[data-edit-name]')?.value??'').trim()
     const maxMb=Number(input.root.querySelector<HTMLInputElement>('[data-edit-memory]')?.value)
     const javaPath=input.root.querySelector<HTMLSelectElement>('[data-edit-java]')?.value
     void api.act('保存实例设置',async()=>{if(!view.editing)throw new Error('实例已变化，请重新选择')
      if(!name)throw new Error('游戏实例名称不能为空')
      if(!Number.isFinite(maxMb)||maxMb<512)throw new Error('内存分配至少为 512 MB')
      const patch:Record<string,unknown>={name,memory:{minMb:1024,maxMb}};if(javaPath)patch.javaPath=javaPath
      await updateInstance(view.editing,patch as never);view.editing=null;advice();input.notify?.('实例设置已保存')});return}
    if(action==='delete'&&id){const instance=getLauncherSnapshot().instances.find(i=>i.id===id);if(!instance)return
     if(!confirm('确定要删除实例「'+instance.name+'」吗？\n实例文件夹中的世界与 Mod 会一并删除，此操作无法撤销。'))return
     void api.act('删除实例',async()=>{await deleteInstance(id);view.editing=null;input.notify?.('实例已删除：'+instance.name)});return}
    if(action==='duplicate'&&id){const instance=getLauncherSnapshot().instances.find(i=>i.id===id);if(!instance)return
     const name=prompt('新实例名称',instance.name+' - 副本');if(!name?.trim())return
     void api.act('复制实例',async()=>{const created=await duplicateInstance(env,id,name.trim(),signal);await api.reload();api.state.selectedId=created.id;input.notify?.('已复制为：'+name.trim())});return}
   },{signal})
   input.root.addEventListener('input',(event:Event)=>{
    const target=event.target as HTMLInputElement
    if(target.dataset.filter!==undefined){api.state.filter=target.value;rerender()}
   },{signal})
   input.root.innerHTML='<div class="dft-side-head"><b>实例列表</b><div class="dft-tools"><button class="inline-button" data-action="refresh">刷新</button></div></div>'
    +'<input class="dft-filter" data-filter placeholder="搜索实例" value="'+api.state.filter+'">'
    +instanceList(api)+'<div class="dft-main-body">'+instanceMain(api,view)+'</div>'
  })
 }
})
