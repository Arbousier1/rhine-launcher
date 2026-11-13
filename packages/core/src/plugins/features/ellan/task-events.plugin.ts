import {defineFeature} from '@rhine/plugin-api'
import type {TaskSnapshot} from '../../../types.ts'
import {emitOriginal} from '../../../ellan/state.ts'
export default defineFeature({
 id:'ellan.task.events',capability:'ellan.task.events',title:'同步原任务激活状态',depends:['events.subscribe.public','events.emit','task.list'],
 execute:()=>({connected:true}),
 setup(env){
  const off=env.use<()=>void>('events.subscribe.public',(event:unknown)=>{
   if(!event||typeof event!=='object'||Reflect.get(event,'type')!=='task')return
   const values=env.use<TaskSnapshot[]>('task.list')
   emitOriginal(env,'task-activated',[values.some(t=>t.status==='queued'||t.status==='running')])
  })
  env.onDispose(off)
 }
})
