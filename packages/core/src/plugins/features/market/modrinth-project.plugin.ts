import { defineFeature } from '@rhine/plugin-api'
import { modrinthClient } from '../../market-client.ts'
import { json,object,string,query,integer } from '../../http-input.ts'

export default defineFeature<any,any>({
 id:'market.modrinth.project',capability:'market.modrinth.project',title:'读取 modrinth 项目',depends:['settings.resolve'],
 http:{method:'GET',path:'/api/market/modrinth/project/:id',decode:(_request,params)=>({id:params.id})},
 execute(input,env){return modrinthClient(env).project(string(input.id??input.projectId))}
})
