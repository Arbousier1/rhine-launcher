import {publicSettings} from '../../system-snapshot.ts'
import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { SettingsService } from '../../../services/settings.ts'

/** Single public operation: settings.get. */
export default defineFeature<any,any>({
  id:"settings.get",capability:"settings.get",title:"settings.get",
  depends:["paths.get","storage.read.sync"],
  http:{method:'GET',path:'/api/settings',decode:()=>undefined,status:200,encode:publicSettings},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.settings',ctx=>new SettingsService(ctx)).get()}
})
