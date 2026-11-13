import {defineFeature,type FeatureEnvironment} from '@rhine/plugin-api'
import {mountLayout,type LayoutHandle,type LayoutInput} from './layout'
interface Mounts{mounted:LayoutHandle|null}
const mounts=(env:FeatureEnvironment)=>env.state<Mounts>('launcher.shell.mounts',()=>({mounted:null}))
/** Shell surface: chrome only. Pages are separate surface features in the slot. */
export default defineFeature<LayoutInput,LayoutHandle>({
 id:'surface.shell',capability:'surface.shell',title:'启动器外壳（导航与页面插槽）',
 optionalDepends:['surface.instances','surface.downloads','surface.settings','launcher.bootstrap','launcher.events.connect'],
 setup(env){const entry=mounts(env);env.onDispose(()=>{entry.mounted?.dispose();entry.mounted=null})},
 execute(input,env){env.signal.throwIfAborted();const entry=mounts(env);entry.mounted?.dispose()
  const handle=mountLayout(env,input);entry.mounted=handle;env.onDispose(()=>handle.dispose());return handle},
})
