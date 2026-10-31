import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.packs.import',capability:'launcher.packs.import',title:'launcher.packs.import',execute:(input,env)=>nativeRequest(env,'/api/instances/import-modpack',{method:'POST',signal:input?.signal,body:{path:input.path,name:input.name}})})
