import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.list',capability:'launcher.accounts.list',title:'读取账户列表',execute:(input,env)=>nativeRequest(env,'/api/accounts',{method:'GET',signal:input?.signal})})
