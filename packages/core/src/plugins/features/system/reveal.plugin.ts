import {defineFeature} from '@rhine/plugin-api'
import {reveal} from '../../system-open.ts'
import {json,string} from '../../http-input.ts'
export default defineFeature<any,Promise<{ok:true}>>({id:'system.reveal',capability:'system.reveal',title:'打开数据目录',depends:['paths.get'],http:{method:'POST',path:'/api/system/reveal',decode:json},async execute(input,env){await reveal(string(input.path),env);return {ok:true}}})
