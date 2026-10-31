import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.updates.apply',capability:'launcher.mods.updates.apply',title:'launcher.mods.updates.apply',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/updates/apply',{method:'POST',signal:input?.signal,body:{updateId:input.updateId,diskName:input.diskName}})})
