import { defineFeature } from '@rhine/plugin-api'
import { curseforgeClient } from '../../market-client.ts'
import { json,object,string,query,integer } from '../../http-input.ts'

export default defineFeature<any,any>({
 id:'market.curseforge.project',capability:'market.curseforge.project',title:'读取 curseforge 项目',depends:['settings.resolve'],
 http:{method:'GET',path:'/api/market/curseforge/project/:id',decode:(_request,params)=>({id:params.id})},
 execute(input,env){return curseforgeClient(env).project(string(input.id??input.projectId))}
})
