import {defineFeature} from '@rhine/plugin-api'
import {nativeRequest,pathId} from '../native-http'
export default defineFeature<any,Promise<any>>({id:'launcher.market.search',capability:'launcher.market.search',title:'launcher.market.search',execute:(input,env)=>nativeRequest(env,'/api/market/search?'+new URLSearchParams({source:String(input.source??'modrinth'),query:String(input.query??''),projectType:'mod',gameVersion:String(input.gameVersion??''),loader:String(input.loader??''),limit:'30'}),{method:'GET',signal:input?.signal})})
