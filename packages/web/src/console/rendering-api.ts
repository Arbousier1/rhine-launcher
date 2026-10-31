import type {FeaturePlugin} from '@rhine/plugin-api'
import {getLauncherRuntime} from './launcher-bridge'
const plugins=import.meta.glob<FeaturePlugin>('./rendering-plugins/*.plugin.ts',{eager:true,import:'default'})
const installed=new WeakMap<ReturnType<typeof getLauncherRuntime>,Promise<void>>()
export function installRenderingFeatures(){const runtime=getLauncherRuntime();let result=installed.get(runtime);if(!result){result=(async()=>{for(const [source,plugin]of Object.entries(plugins))if(!runtime.definition(plugin.id))runtime.register(plugin,source);await runtime.settled();for(const plugin of Object.values(plugins))await runtime.enable(plugin.id)})();installed.set(runtime,result)}return result}
