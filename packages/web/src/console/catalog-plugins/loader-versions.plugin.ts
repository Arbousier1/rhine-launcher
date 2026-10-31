import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.loader.versions',capability:'launcher.loader.versions',title:'launcher.loader.versions',execute:(input,env)=>catalogRequest(env,'/api/loaders/'+loaderKind(input.kind)+'?gameVersion='+inputId(input.gameVersion))})
