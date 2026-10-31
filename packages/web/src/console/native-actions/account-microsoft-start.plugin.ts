import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.microsoft.start',capability:'launcher.accounts.microsoft.start',title:'launcher.accounts.microsoft.start',execute:(input,env)=>nativeRequest(env,'/api/accounts/microsoft/start',{method:'POST',signal:input?.signal,body:{clientId:input.clientId}})})
