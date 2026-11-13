import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.updates.apply',capability:'launcher.mods.updates.apply',title:'应用已核验的 Mod 更新',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/updates/apply',{method:'POST',signal:input?.signal,body:{updateId:input.updateId,diskName:input.diskName}})})
