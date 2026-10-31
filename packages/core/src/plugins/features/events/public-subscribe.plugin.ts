import {defineFeature} from '@rhine/plugin-api'
export default defineFeature<(event:unknown)=>void,()=>void>({
 id:'events.subscribe.public',capability:'events.subscribe.public',title:'订阅公开事件',depends:['events.subscribe','events.redact'],
 execute(listener,env){const stop=env.use<()=>void>('events.subscribe',(value:unknown)=>{if(!env.signal.aborted)listener(env.use('events.redact',value))});env.onDispose(stop);return stop}
})
