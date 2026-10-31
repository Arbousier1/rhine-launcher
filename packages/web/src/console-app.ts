/** Native derivative entry: retained RhineLab renderer, independently scoped launcher operations. */
import {getLauncherRuntime,disposeLauncher} from './console/launcher-bridge'
import {installCatalogFeatures} from './console/catalog-api'
import terminal from './console/ui.plugin'
import {installNativeFeatures} from './console/native-api'
import {installRenderingFeatures} from './console/rendering-api'
const runtime=getLauncherRuntime()
runtime.register(terminal)
async function boot(){await installCatalogFeatures();await installNativeFeatures();await installRenderingFeatures();await runtime.settled();await runtime.enable(terminal.id);await runtime.call<Promise<void>>(terminal.id)}
void boot().catch(error=>{console.error(error);const stage=document.getElementById('stage');if(stage)stage.textContent='界面载入失败：'+(error instanceof Error?error.message:String(error))})
window.addEventListener('pagehide',()=>{void disposeLauncher()},{once:true})
if(import.meta.hot)import.meta.hot.dispose(()=>{void disposeLauncher()})
