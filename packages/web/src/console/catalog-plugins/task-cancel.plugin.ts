import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.task.cancel',capability:'launcher.task.cancel',title:'launcher.task.cancel',execute:(input,env)=>catalogRequest(env,'/api/tasks/'+inputId(input.id)+'/cancel',{})})
