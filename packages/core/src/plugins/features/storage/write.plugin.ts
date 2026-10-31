import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { StorageService } from '../../../services/storage.ts'

/** Single public operation: storage.write. */
export default defineFeature<any,any>({
  id:"storage.write",capability:"storage.write",title:"storage.write",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.storage',ctx=>new StorageService(ctx)).write(string(input.file),input.value,env.signal)}
})
