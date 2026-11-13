import {defineFeature,FeatureError,type FeatureEnvironment} from '@rhine/plugin-api'

/** The experimental entry passes its stage root; the terminal resolves #stage itself. */
export interface ExperimentalUiInput{root?:HTMLElement;notify?:(message:string)=>void}
/** Same handle shape as every other native UI feature (panel.*, console.default.ui). */
export interface ExperimentalUiHandle{dispose():void}

interface MountSlot{handle:ExperimentalUiHandle|null;pending:Promise<ExperimentalUiHandle>|null;retired:boolean}
const MOUNTS='archive.ui.experimental.mounts'
const mounts=(env:FeatureEnvironment)=>env.state<MountSlot>(MOUNTS,()=>({handle:null,pending:null,retired:false}))
const retired=()=>new FeatureError('MOUNT_RETIRED','实验界面已卸载，需先停用再重新启用该功能才能再次挂载',409)

// console.ui.mount is the eager terminal this fiber supersedes: a declared
// relationship, never invoked. The rest is exactly what mountConsole() resolves
// through env.use() — env.use() rejects anything it has not declared.
const dependencies=['console.ui.mount','renderer.webgl.create','renderer.webgpu.create','panel.accounts','panel.mods','panel.packs','launcher.bootstrap','launcher.events.connect','launcher.launch.start','launcher.session.stop','launcher.instance.create','launcher.account.offline','launcher.mods.list','launcher.system.reveal','launcher.versions.list','launcher.version.details','launcher.loader.versions','launcher.version.install','launcher.loader.install','launcher.task.wait','launcher.task.cancel']

/**
 * Opt-in three.js archive terminal. Registered like any other single-capability
 * feature but inactive until the host explicitly enables it, and ../main is
 * imported only from execute() so a disabled feature carries no scene code and
 * starts no renderer. setup() owns the one mount slot of its enabled era, so a
 * disable/unload tears the terminal down and the next enable starts empty.
 */
export default defineFeature<ExperimentalUiInput|undefined,Promise<ExperimentalUiHandle>>({
 id:'archive.ui.experimental',capability:'archive.ui.experimental',
 title:'实验性三维档案终端（默认停用）',
 description:'默认关闭的实验界面：只有显式启用后才会加载 three.js 档案终端的场景代码。',
 optionalDepends:dependencies,
 /** One slot, one inverse: unload never accumulates cleanup or a second canvas. */
 setup(env){
  const slot=mounts(env)
  slot.handle?.dispose()
  slot.handle=null;slot.pending=null;slot.retired=false
  env.onDispose(()=>{slot.retired=true;slot.pending=null;const handle=slot.handle;slot.handle=null;handle?.dispose()})
 },
 async execute(_input,env){
  env.signal.throwIfAborted()
  const slot=mounts(env)
  if(slot.retired)throw retired()
  if(slot.handle)return slot.handle
  // Claimed synchronously: concurrent callers share one in-flight mount instead of
  // racing two scenes into the same stage.
  if(slot.pending)return slot.pending
  const connect=async():Promise<ExperimentalUiHandle>=>{
   const {mountConsole}=await import('../main')
   // The dynamic import is not abortable; re-check the caller once it settles.
   env.signal.throwIfAborted()
   if(slot.retired)throw retired()
   mountConsole(env)
   let disposed=false
   const handle:ExperimentalUiHandle={dispose(){
    if(disposed)return
    disposed=true
    slot.retired=true
    if(slot.handle===handle)slot.handle=null
   }}
   slot.handle=handle
   return handle
  }
  const pending=connect().finally(()=>{if(slot.pending===pending)slot.pending=null})
  slot.pending=pending
  return pending
 },
})
