import {instancePatch,settingsPatch,launchRequest} from '../../validation.ts'
import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService, normalizeConfig } from '../../../services/instances.ts'

/** Single public operation: instance.create. */
export default defineFeature<any,any>({
  id:"instance.create",capability:"instance.create",title:"instance.create",
  depends:["paths.get","storage.write","events.emit"],
  http:{method:'POST',path:'/api/instances',decode:async request=>instancePatch(await json(request),false),status:201},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).create(normalizeConfig({...object(input),name:string(input.name,'档案名称',120),gameVersion:identifier(input.gameVersion,'游戏版本')}),env.signal)}
})
