import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { BusService } from '../../../services/bus.ts'

/** Single public operation: events.subscribe. */
export default defineFeature<any,any>({
  id:"events.subscribe",capability:"events.subscribe",title:"events.subscribe",
  depends:[],
  execute(input:any,env:FeatureEnvironment){const unsubscribe=implementation(env,'engine.bus',ctx=>new BusService(ctx)).subscribe(input); const abort=()=>unsubscribe();env.signal.addEventListener('abort',abort,{once:true});env.onDispose(()=>{unsubscribe();env.signal.removeEventListener('abort',abort)});return()=>{unsubscribe();env.signal.removeEventListener('abort',abort)}}
})
