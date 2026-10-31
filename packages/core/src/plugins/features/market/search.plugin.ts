import { defineFeature,FeatureError } from '@rhine/plugin-api'
import { query,object } from '../../http-input.ts'
import {marketQuery} from '../../validation.ts'
/** One workflow; source-specific search implementations are separate plugins. */
export default defineFeature<any,any>({
 id:'market.search',capability:'market.search',title:'搜索内容工作流',optionalDepends:['market.modrinth.search','market.curseforge.search'],
 http:{method:'GET',path:'/api/market/search',decode:request=>marketQuery(query(request))},
 execute(input,env){const source=object(input).source??'modrinth';if(!['modrinth','curseforge'].includes(source))throw new FeatureError('VALIDATION_ERROR','未知内容来源',400);return env.use('market.'+source+'.search',input)}
})
