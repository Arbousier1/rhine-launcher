import {defineFeature} from '@rhine/plugin-api'
import {checkCurseForge} from '../../../mods/updates/curseforge.ts'
import {readId} from '../../http-input.ts'
export default defineFeature<any,ReturnType<typeof checkCurseForge>>({
 id:'mod.update.curseforge.check',capability:'mod.update.curseforge.check',title:'检查 curseforge 模组更新',depends:['paths.get','instance.get','mod.list','settings.resolve'],
 http:{method:'GET',path:'/api/instances/:id/mods/updates/curseforge',decode:(_request,params)=>({id:params.id})},
 execute:(input,env)=>checkCurseForge(readId(input),env)
})
