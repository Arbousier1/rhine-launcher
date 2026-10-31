import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.settings.update',capability:'launcher.accounts.settings.update',title:'launcher.accounts.settings.update',execute:(input,env)=>nativeRequest(env,'/api/settings',{method:'PATCH',signal:input?.signal,body:input.patch})})
