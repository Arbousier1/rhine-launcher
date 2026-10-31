import { defineFeature } from '@rhine/plugin-api'
import { curseforgeClient } from '../../market-client.ts'
import { json,object,string,query,integer } from '../../http-input.ts'

export default defineFeature<any,any>({
 id:'market.curseforge.search',capability:'market.curseforge.search',title:'搜索 curseforge 内容',depends:['settings.resolve'],
 http:{method:'GET',path:'/api/market/curseforge/search',decode:request=>query(request)},
 execute(input,env){return curseforgeClient(env).search({...object(input),query:input.query??'',offset:integer(input.offset,'offset',0,100000,0),limit:integer(input.limit,'limit',1,100,20)})}
})
