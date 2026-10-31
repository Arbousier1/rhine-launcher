import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.microsoft.cancel',capability:'launcher.accounts.microsoft.cancel',title:'launcher.accounts.microsoft.cancel',execute:(input,env)=>nativeRequest(env,'/api/accounts/microsoft/cancel',{method:'POST',signal:input?.signal,body:{flowId:input.flowId}})})
