import {defineFeature} from '@rhine/plugin-api'
import {openExternal} from '../../system-open.ts'
import {json,string} from '../../http-input.ts'
export default defineFeature<any,Promise<{ok:true}>>({id:'system.open-external',capability:'system.open-external',title:'在浏览器打开链接',http:{method:'POST',path:'/api/system/open',decode:json},async execute(input){await openExternal(string(input.url));return {ok:true}}})
