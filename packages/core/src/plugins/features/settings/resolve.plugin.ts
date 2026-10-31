import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { SettingsService } from '../../../services/settings.ts'

/** Single public operation: settings.resolve. */
export default defineFeature<any,any>({
  id:"settings.resolve",capability:"settings.resolve",title:"settings.resolve",
  depends:["paths.get","storage.read.sync"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.settings',ctx=>new SettingsService(ctx)).resolved()}
})
