import {publicSettings} from '../../system-snapshot.ts'
import {instancePatch,settingsPatch,launchRequest} from '../../validation.ts'
import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { SettingsService } from '../../../services/settings.ts'

/** Single public operation: settings.update. */
export default defineFeature<any,any>({
  id:"settings.update",capability:"settings.update",title:"settings.update",
  depends:["paths.get","storage.read.sync","storage.write","paths.reset","events.emit"],
  http:{method:'PATCH',path:'/api/settings',decode:async request=>settingsPatch(await json(request)),status:200,encode:publicSettings},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.settings',ctx=>new SettingsService(ctx)).update(object(input))}
})
