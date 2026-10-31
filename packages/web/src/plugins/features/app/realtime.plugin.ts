import {defineFeature} from '../../define.ts'
import {startAppEvents} from '@/app/data.ts'
export default defineFeature({
 id:'app.realtime',capability:'app.realtime',title:'实时事件订阅',kind:'effect',depends:['app.bootstrap'],
 description:'仅负责实时订阅。停用只关闭订阅；HTTP 刷新和已有快照仍可用。',
 setup(env){if(typeof window!=='undefined')env.onDispose(startAppEvents())}
})
