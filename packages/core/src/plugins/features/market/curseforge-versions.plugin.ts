import { defineFeature } from '@rhine/plugin-api'
import { curseforgeClient } from '../../market-client.ts'
import { json,object,string,query,integer } from '../../http-input.ts'

export default defineFeature<any,any>({
 id:'market.curseforge.versions',capability:'market.curseforge.versions',title:'读取 curseforge 项目版本',depends:['settings.resolve'],
 http:{method:'GET',path:'/api/market/curseforge/:id/versions',decode:(request,params)=>({projectId:params.id,filter:query(request)})},
 execute(input,env){return curseforgeClient(env).versions(string(input.projectId??input.id),input.filter??{})}
})
