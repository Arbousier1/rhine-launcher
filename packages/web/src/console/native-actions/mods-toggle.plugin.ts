import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.toggle',capability:'launcher.mods.toggle',title:'launcher.mods.toggle',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/'+pathId(input.diskName)+'/toggle',{method:'POST',signal:input?.signal,body:{enabled:input.enabled}})})
