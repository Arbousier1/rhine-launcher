import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.updates.curseforge',capability:'launcher.mods.updates.curseforge',title:'launcher.mods.updates.curseforge',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/updates/curseforge',{method:'GET',signal:input?.signal})})
