import type {FeaturePlugin} from '@rhine/plugin-api'
import {getLauncherRuntime} from './launcher-bridge'
import type {GameVersion} from './catalog-model'
const modules=import.meta.glob<{default:FeaturePlugin}>('./catalog-plugins/*.plugin.ts',{eager:true})
const mounts=new WeakMap<ReturnType<typeof getLauncherRuntime>,Promise<void>>()
export function installCatalogFeatures():Promise<void>{
 const runtime=getLauncherRuntime();let mounting=mounts.get(runtime);if(!mounting){mounting=(async()=>{for(const {default:plugin}of Object.values(modules))if(!runtime.definition(plugin.id))runtime.register(plugin);await runtime.settled();for(const {default:plugin}of Object.values(modules))await runtime.enable(plugin.id)})();mounts.set(runtime,mounting)}return mounting
}
export async function catalogCall<T>(id:string,input:unknown={},signal?:AbortSignal):Promise<T>{await installCatalogFeatures();return getLauncherRuntime().call<T|Promise<T>>(id,input,{signal})}
export const getVersions=(signal?:AbortSignal)=>catalogCall<GameVersion[]>('launcher.versions.list',{},signal)
export const getVersionDetails=(id:string,signal?:AbortSignal)=>catalogCall<{id:string;javaVersion?:{majorVersion:number;component?:string};type?:string}>('launcher.version.details',{id},signal)
export const getLoaderVersions=(kind:string,gameVersion:string,signal?:AbortSignal)=>catalogCall<{version:string;stable?:boolean}[]>('launcher.loader.versions',{kind,gameVersion},signal)
export async function waitInstallTask(id:string,signal?:AbortSignal):Promise<void>{const task=await catalogCall<{status:string;error?:string|{message?:string}}>('launcher.task.wait',{id},signal);if(task.status!=='succeeded')throw new Error(typeof task.error==='string'?task.error:task.error?.message??(task.status==='cancelled'?'安装已取消，已创建的实例保留，可稍后重试':'安装任务失败'))}
