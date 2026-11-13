import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.accounts.settings.update',capability:'launcher.accounts.settings.update',title:'保存启动器设置',execute:(input,env)=>nativeRequest(env,'/api/settings',{method:'PATCH',signal:input?.signal,body:input.patch})})
