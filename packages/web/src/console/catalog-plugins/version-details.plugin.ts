import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.version.details',capability:'launcher.version.details',title:'launcher.version.details',execute:(input,env)=>catalogRequest(env,'/api/versions/'+inputId(input.id)+'/json')})
