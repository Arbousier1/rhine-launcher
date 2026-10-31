import {instancePatch,settingsPatch,launchRequest} from '../../validation.ts'
import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: instance.update. */
export default defineFeature<any,any>({
  id:"instance.update",capability:"instance.update",title:"instance.update",
  depends:["paths.get","storage.write","events.emit"],
  http:{method:'PATCH',path:'/api/instances/:id',decode:async(request,params)=>({id:params.id,patch:instancePatch(await json(request),true)}),status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).update(readId(input),object(input.patch))}
})
