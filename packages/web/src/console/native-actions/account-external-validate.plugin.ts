import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.external.validate',capability:'launcher.accounts.external.validate',title:'校验外置登录令牌',execute:(input,env)=>nativeRequest(env,'/api/accounts/authlib-injector/'+pathId(input.id)+'/validate',{method:'POST',signal:input?.signal,body:{}})})
