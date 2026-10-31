import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { BusService } from '../../../services/bus.ts'

/** Single public operation: events.emit. */
export default defineFeature<any,any>({
  id:"events.emit",capability:"events.emit",title:"events.emit",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.bus',ctx=>new BusService(ctx)).emit(input)}
})
