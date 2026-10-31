import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.versions.installed',capability:'launcher.versions.installed',title:'launcher.versions.installed',execute:(input,env)=>catalogRequest<string[]>(env,'/api/versions/installed')})
