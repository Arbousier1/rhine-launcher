import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.refresh',capability:'launcher.accounts.refresh',title:'launcher.accounts.refresh',execute:(input,env)=>nativeRequest(env,'/api/accounts/'+pathId(input.id)+'/refresh',{method:'POST',signal:input?.signal,body:{}})})
