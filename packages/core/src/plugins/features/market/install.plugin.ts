import { defineFeature,FeatureError } from '@rhine/plugin-api'
import { json,object } from '../../http-input.ts'
import {marketInstallInput} from '../../validation.ts'
/** One install action composes the selected content-provider plugin. */
export default defineFeature<any,any>({
 id:'market.install',capability:'market.install',title:'安装内容工作流',optionalDepends:['market.modrinth.install','market.curseforge.install'],
 http:{method:'POST',path:'/api/market/install',decode:async request=>marketInstallInput(await json(request)),background:{kind:'market-install',title:'安装内容'}},
 execute(input,env){const source=object(input.version).source;if(!['modrinth','curseforge'].includes(source))throw new FeatureError('VALIDATION_ERROR','未知内容来源',400);return env.use('market.'+source+'.install',input)}
})
