import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.native.list',capability:'launcher.mods.native.list',title:'读取实例 Mod 列表',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods',{method:'GET',signal:input?.signal})})
