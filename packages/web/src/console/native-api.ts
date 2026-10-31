import type {FeaturePlugin} from '@rhine/plugin-api'
import {getLauncherRuntime} from './launcher-bridge'
const actions=import.meta.glob<FeaturePlugin>('./native-actions/*.plugin.ts',{eager:true,import:'default'})
const panels=import.meta.glob<FeaturePlugin>('./native/**/panel.plugin.ts',{eager:true,import:'default'})
const mounted=new WeakMap<ReturnType<typeof getLauncherRuntime>,Promise<void>>()
export function installNativeFeatures():Promise<void>{const runtime=getLauncherRuntime();let ready=mounted.get(runtime);if(!ready){ready=(async()=>{for(const [source,plugin]of Object.entries({...actions,...panels}))if(!runtime.definition(plugin.id))runtime.register(plugin,source);await runtime.settled();for(const plugin of Object.values({...actions,...panels}))await runtime.enable(plugin.id)})();mounted.set(runtime,ready)}return ready}
