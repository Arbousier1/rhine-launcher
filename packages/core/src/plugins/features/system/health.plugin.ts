import { defineFeature } from '@rhine/plugin-api'
import {featureHealth} from '../../system-snapshot.ts'
export default defineFeature<void,Record<string,unknown>>({id:'health',capability:'health',title:'查询宿主健康状态',http:{method:'GET',path:'/api/health',decode:()=>undefined},execute:(_input,env)=>featureHealth(env)})
