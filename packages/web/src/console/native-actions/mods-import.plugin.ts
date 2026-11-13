import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.mods.import',capability:'launcher.mods.import',title:'导入本地 Mod 文件',execute:(input,env)=>nativeRequest(env,'/api/instances/'+pathId(input.id)+'/mods/import',{method:'POST',signal:input?.signal,body:{path:input.path}})})
