import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.market.versions',capability:'launcher.market.versions',title:'读取项目兼容版本',execute:(input,env)=>nativeRequest(env,'/api/market/'+pathId(input.source)+'/'+pathId(input.projectId)+'/versions?'+new URLSearchParams({gameVersion:String(input.gameVersion??''),loader:String(input.loader??'')}),{method:'GET',signal:input?.signal})})
