import {defineFeature} from '@rhine/plugin-api'
import {applyUpdate} from '../../../mods/updates/apply.ts'
import {json} from '../../http-input.ts'
export default defineFeature<any,ReturnType<typeof applyUpdate>>({
 id:'mod.update.apply',capability:'mod.update.apply',title:'应用已核验的模组更新',depends:['paths.get','instance.get'],
 http:{method:'POST',path:'/api/instances/:id/mods/updates/apply',decode:async(request,params)=>({...await json(request),id:params.id}),background:{kind:'mod-update',title:'更新模组'}},
 execute:applyUpdate
})
