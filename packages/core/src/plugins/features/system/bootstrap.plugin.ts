import { defineFeature } from '@rhine/plugin-api'
import {publicAccount,publicSettings} from '../../system-snapshot.ts'
import {defaultSettings} from '../../../services/settings.ts'
import type { Settings,Account } from '../../../types.ts'
import type { RhPaths } from '../../../contracts.ts'

/** Missing optional capabilities are explicitly represented, never silently reported as data. */
export default defineFeature<void,Promise<Record<string,unknown>>>({
 id:'bootstrap',capability:'bootstrap',title:'读取界面启动快照',
 optionalDepends:['paths.get','settings.get','instance.list','account.list','java.list','session.list','task.list'],
 http:{method:'GET',path:'/api/bootstrap',decode:()=>undefined},
 async execute(_input,env){
  const unavailable:Record<string,unknown>={}
  const read=async<T,>(field:string,id:string,fallback:T):Promise<T>=>{
   if(!env.context.features.has(id)){unavailable[field]={feature:id,status:env.context.features.get(id)?.status??'missing',code:'PLUGIN_UNAVAILABLE'};return fallback}
   try{return await env.use<T>(id)}catch(error:any){unavailable[field]={feature:id,status:'error',code:error.code??'FEATURE_ERROR',message:error.message};return fallback}
  }
  const paths=await read<RhPaths>('paths','paths.get',{root:'',instances:'',libraries:'',versions:'',assets:'',java:'',logs:'',temp:''})
  const settings=await read<Settings>('settings','settings.get',defaultSettings())
  const instances=await read<unknown[]>('instances','instance.list',[])
  const accounts=await read<Account[]>('accounts','account.list',[])
  const javaRuntimes=await read<unknown[]>('javaRuntimes','java.list',[])
  const sessions=await read<unknown[]>('sessions','session.list',[])
  const tasks=await read<unknown[]>('tasks','task.list',[])
  return {app:{name:'Rhine Launcher',version:'0.2.0',pid:process.pid,platform:process.platform},paths,settings:publicSettings(settings),instances,accounts:accounts.map(publicAccount),javaRuntimes,sessions,tasks,unavailable,plugins:env.context.features.list()}
 }
})
