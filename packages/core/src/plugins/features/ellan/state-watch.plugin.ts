import {defineFeature} from '@rhine/plugin-api'
import {attachOriginalStateWatch,STATE_GETTERS} from '../../../ellan/watch.ts'
export default defineFeature({id:'ellan.state.watch',capability:'ellan.state.watch',title:'同步原始文件与状态变化',depends:['events.subscribe.public','events.emit'],optionalDepends:STATE_GETTERS,execute:()=>({connected:true}),setup(env){env.onDispose(attachOriginalStateWatch(env))}})
