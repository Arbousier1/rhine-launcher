import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.list',capability:'launcher.accounts.list',title:'launcher.accounts.list',execute:(input,env)=>nativeRequest(env,'/api/accounts',{method:'GET',signal:input?.signal})})
