import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.microsoft.complete',capability:'launcher.accounts.microsoft.complete',title:'完成微软设备码登录',execute:(input,env)=>nativeRequest(env,'/api/accounts/microsoft/complete',{method:'POST',signal:input?.signal,body:{flowId:input.flowId}})})
