import { defineFeature } from '@rhine/plugin-api'
import { join } from 'node:path'
import type { Instance } from '../../../types.ts'
import type { RhPaths } from '../../../contracts.ts'
import { planLibraries } from '../../../runtime/command.ts'
import { currentPlatform } from '../../../runtime/rules.ts'
import { extractNatives } from '../../../runtime/natives.ts'
export default defineFeature<any,Promise<void>>({
 id:'minecraft.natives.extract',capability:'minecraft.natives.extract',title:'提取原生运行库',depends:['paths.get','instance.get'],
 async execute(input,env){
  const paths=env.use<RhPaths>('paths.get')
  const instance=env.use<Instance|undefined>('instance.get',{id:input.instanceId})
  if(!instance)throw new Error('实例不存在')
  for(const plan of planLibraries(input.version.libraries,currentPlatform(),paths.libraries).filter(item=>item.native)){
   env.signal.throwIfAborted();env.task?.throwIfCancelled()
   await extractNatives(plan.path,join(instance.path,'natives'),plan.exclude)
  }
 }
})
