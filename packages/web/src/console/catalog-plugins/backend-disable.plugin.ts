import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.plugins.disable',capability:'launcher.plugins.disable',title:'launcher.plugins.disable',execute:(input,env)=>catalogRequest(env,'/api/plugins/'+inputId(input.id)+'/disable',{})})
