import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.updates.modrinth',capability:'launcher.mods.updates.modrinth',title:'检查 Modrinth 更新',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/updates',{method:'GET',signal:input?.signal})})
