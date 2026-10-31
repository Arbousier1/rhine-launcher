import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.remove',capability:'launcher.mods.remove',title:'launcher.mods.remove',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/'+pathId(input.diskName),{method:'DELETE',signal:input?.signal})})
