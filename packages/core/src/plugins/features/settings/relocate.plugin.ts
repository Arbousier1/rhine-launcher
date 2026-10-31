import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { SettingsService } from '../../../services/settings.ts'

/** Single public operation: settings.relocate. */
export default defineFeature<any,any>({
  id:"settings.relocate",capability:"settings.relocate",title:"settings.relocate",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.settings',ctx=>new SettingsService(ctx)).relocate(string(input.root))}
})
