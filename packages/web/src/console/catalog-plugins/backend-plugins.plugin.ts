import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.plugins.list',capability:'launcher.plugins.list',title:'launcher.plugins.list',execute:(input,env)=>catalogRequest(env,'/api/plugins')})
