import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.settings',capability:'launcher.accounts.settings',title:'读取启动器设置',execute:(input,env)=>nativeRequest(env,'/api/settings',{method:'GET',signal:input?.signal})})
