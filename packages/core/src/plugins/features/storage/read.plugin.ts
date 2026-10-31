import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { StorageService } from '../../../services/storage.ts'

/** Single public operation: storage.read. */
export default defineFeature<any,any>({
  id:"storage.read",capability:"storage.read",title:"storage.read",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.storage',ctx=>new StorageService(ctx)).read(string(input.file),input.fallback)}
})
