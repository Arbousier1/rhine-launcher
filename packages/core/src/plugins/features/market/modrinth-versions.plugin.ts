import { defineFeature } from '@rhine/plugin-api'
import { modrinthClient } from '../../market-client.ts'
import { json,object,string,query,integer } from '../../http-input.ts'

export default defineFeature<any,any>({
 id:'market.modrinth.versions',capability:'market.modrinth.versions',title:'读取 modrinth 项目版本',depends:['settings.resolve'],
 http:{method:'GET',path:'/api/market/modrinth/:id/versions',decode:(request,params)=>({projectId:params.id,filter:query(request)})},
 execute(input,env){return modrinthClient(env).versions(string(input.projectId??input.id),input.filter??{})}
})
