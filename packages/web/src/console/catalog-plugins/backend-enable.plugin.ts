import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.plugins.enable',capability:'launcher.plugins.enable',title:'launcher.plugins.enable',execute:(input,env)=>catalogRequest(env,'/api/plugins/'+inputId(input.id)+'/enable',{})})
