import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.market.install',capability:'launcher.market.install',title:'launcher.market.install',execute:(input,env)=>nativeRequest(env,'/api/market/install',{method:'POST',signal:input?.signal,body:{instanceId:input.instanceId,version:input.version}})})
