import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.packs.identify',capability:'launcher.packs.identify',title:'launcher.packs.identify',execute:(input,env)=>nativeRequest(env,'/api/modpacks/identify',{method:'POST',signal:input?.signal,body:{path:input.path,name:input.name}})})
