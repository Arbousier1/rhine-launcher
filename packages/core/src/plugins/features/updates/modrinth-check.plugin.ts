import {defineFeature} from '@rhine/plugin-api'
import {checkModrinth} from '../../../mods/updates/modrinth.ts'
import {readId} from '../../http-input.ts'
export default defineFeature<any,ReturnType<typeof checkModrinth>>({
 id:'mod.update.modrinth.check',capability:'mod.update.modrinth.check',title:'检查 modrinth 模组更新',depends:['paths.get','instance.get','mod.list','settings.resolve'],
 http:{method:'GET',path:'/api/instances/:id/mods/updates',decode:(_request,params)=>({id:params.id})},
 execute:(input,env)=>checkModrinth(readId(input),env)
})
