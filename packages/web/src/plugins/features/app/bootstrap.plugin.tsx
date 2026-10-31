import {defineFeature} from '../../define.ts'
import {useAppStore,stopAppData} from '@/app/data.ts'
/** Boot is an effect, not a hidden React component in an unrendered slot. */
export default defineFeature({
 id:'app.bootstrap',capability:'app.bootstrap',title:'应用数据自举',
 description:'读取一次公开快照；卸载取消请求，但保留已有本地显示数据。实时订阅由另一插件管理。',kind:'effect',
 setup(env){if(typeof window==='undefined')return;env.onDispose(stopAppData);void useAppStore.getState().init(env.signal)}
})
