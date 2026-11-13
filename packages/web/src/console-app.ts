/** Experimental entry: the three.js archive terminal runs only when this plugin is explicitly enabled. */
import {getLauncherRuntime,disposeLauncher} from './console/launcher-bridge'
import {installCatalogFeatures} from './console/catalog-api'
import {installNativeFeatures} from './console/native-api'
import {installRenderingFeatures} from './console/rendering-api'
import experimental from './console/experimental/experimental-ui.plugin'
const runtime=getLauncherRuntime()
runtime.register(experimental)
async function boot(){
 await installCatalogFeatures();await installNativeFeatures();await installRenderingFeatures();await runtime.settled()
 await runtime.enable(experimental.id)
 const stage=document.getElementById('stage')
 if(!stage)throw new Error('找不到界面挂载点')
 await runtime.call<unknown>(experimental.id,{root:stage})
}
void boot().catch(error=>{console.error(error);const stage=document.getElementById('stage');if(stage)stage.textContent='界面载入失败：'+(error instanceof Error?error.message:String(error))})
window.addEventListener('pagehide',()=>{void disposeLauncher()},{once:true})
if(import.meta.hot)import.meta.hot.dispose(()=>{void disposeLauncher()})
