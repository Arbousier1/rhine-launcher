/**
 * Default product entry. Every page is an independent surface feature; this
 * file only discovers and mounts the shell, exactly like a DSH host entry.
 */
import {getLauncherRuntime,disposeLauncher} from './console/launcher-bridge'
import {installCatalogFeatures} from './console/catalog-api'
import {installNativeFeatures} from './console/native-api'
import {installDefaultUi,shellPlugin} from './console/default-ui/native-api'
import './styles/tokens.css'
import './console/default-ui/shell.css'

const runtime=getLauncherRuntime()
async function boot(){
 await installCatalogFeatures()
 await installNativeFeatures()
 await installDefaultUi()
 const stage=document.getElementById('stage')
 if(!stage)throw new Error('找不到界面挂载点')
 if(!shellPlugin)throw new Error('缺少外壳插件 surface.shell')
 const toast=document.getElementById('toast')
 await runtime.call<unknown>(shellPlugin.id,{root:stage,notify:(message:string)=>{
  if(!toast)return;toast.textContent=message;toast.classList.add('visible')
  setTimeout(()=>toast.classList.remove('visible'),2400)
 }})
}
void boot().catch(error=>{console.error(error);const stage=document.getElementById('stage');if(stage)stage.textContent='界面载入失败：'+(error instanceof Error?error.message:String(error))})
window.addEventListener('pagehide',()=>{void disposeLauncher()},{once:true})
if(import.meta.hot)import.meta.hot.dispose(()=>{void disposeLauncher()})
