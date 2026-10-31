import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { StorageService } from '../../../services/storage.ts'

/** Single public operation: storage.read.sync. */
export default defineFeature<any,any>({
  id:"storage.read.sync",capability:"storage.read.sync",title:"storage.read.sync",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.storage',ctx=>new StorageService(ctx)).readSync(string(input.file),input.fallback)}
})
