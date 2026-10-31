import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.external.login',capability:'launcher.accounts.external.login',title:'launcher.accounts.external.login',execute:(input,env)=>nativeRequest(env,'/api/accounts/authlib-injector',{method:'POST',signal:input?.signal,body:{authServerUrl:input.authServerUrl,username:input.username,password:input.password,profileId:input.profileId}})})
