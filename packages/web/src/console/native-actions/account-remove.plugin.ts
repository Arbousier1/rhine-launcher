import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.remove',capability:'launcher.accounts.remove',title:'移除账户',execute:(input,env)=>nativeRequest(env,'/api/accounts/'+pathId(input.id),{method:'DELETE',signal:input?.signal})})
