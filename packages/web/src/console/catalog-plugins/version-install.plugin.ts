import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.version.install',capability:'launcher.version.install',title:'launcher.version.install',execute:(input,env)=>catalogRequest<{taskId:string}>(env,'/api/versions/install',{gameVersion:input.gameVersion})})
