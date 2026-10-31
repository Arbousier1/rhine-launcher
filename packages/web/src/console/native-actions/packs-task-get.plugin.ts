import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.tasks.get',capability:'launcher.tasks.get',title:'launcher.tasks.get',execute:(input,env)=>nativeRequest(env,'/api/tasks/'+pathId(input.id),{method:'GET',signal:input?.signal})})
