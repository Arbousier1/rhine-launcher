import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.loader.install',capability:'launcher.loader.install',title:'launcher.loader.install',execute:(input,env)=>catalogRequest<{taskId:string}>(env,'/api/loaders/'+loaderKind(input.kind)+'/install',{gameVersion:input.gameVersion,loaderVersion:input.loaderVersion})})
