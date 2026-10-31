import type {FeatureEnvironment} from '@rhine/plugin-api'
import type {ArchiveBackend,ArchiveBackendFactory} from './backend'
const registry=(env:FeatureEnvironment,id:string)=>env.state('renderer.backends:'+id,()=>({active:new Set<ArchiveBackend>()}))
export function setupRendererFeature(env:FeatureEnvironment,id:string){const state=registry(env,id);env.onDispose(()=>{for(const backend of [...state.active]){backend.onLost?.('渲染后端插件已停用');backend.dispose()}state.active.clear()})}
export function ownRendererFactory(env:FeatureEnvironment,id:string,factory:ArchiveBackendFactory):ArchiveBackendFactory{return(...args)=>{env.signal.throwIfAborted();const backend=factory(...args),state=registry(env,id),dispose=backend.dispose.bind(backend);let disposed=false;state.active.add(backend);backend.dispose=()=>{if(disposed)return;disposed=true;state.active.delete(backend);dispose()};return backend}}
