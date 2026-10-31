import {defineFeature} from '@rhine/plugin-api'
import {catalogRequest,inputId,loaderKind} from '../catalog-http'
export default defineFeature<any,any>({id:'launcher.versions.list',capability:'launcher.versions.list',title:'launcher.versions.list',execute:(input,env)=>catalogRequest<import('../catalog-model').GameVersion[]>(env,'/api/versions/remote?includeSnapshots=true')})
