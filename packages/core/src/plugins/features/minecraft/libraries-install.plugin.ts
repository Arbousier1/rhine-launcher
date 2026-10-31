import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RawVersionJson, RhPaths } from '../../../contracts.ts'
import { identifier, object } from '../../http-input.ts'
import { stat } from 'node:fs/promises'
import { relative,sep } from 'node:path'
import { planLibraries } from '../../../runtime/command.ts'
import { currentPlatform } from '../../../runtime/rules.ts'
/** Install libraries/natives archives for exactly the current platform. */
export default defineFeature<{version:RawVersionJson},Promise<void>>({
 id:'minecraft.libraries.install',capability:'minecraft.libraries.install',title:'安装运行库',depends:['paths.get','download.batch'],
 async execute(input,env){
  const paths=env.use<RhPaths>('paths.get')
  const plans=planLibraries(input.version.libraries,currentPlatform(),paths.libraries)
  const files=[]
  for(const item of plans){
   const path=relative(paths.libraries,item.path)
   if(path.startsWith('..'+sep)||path==='..'||path.includes(':'))throw new Error('运行库路径越界')
   if(item.url)files.push({url:item.url,destination:item.path,sha1:item.sha1,size:item.size,skipIfExists:true})
   else if(!(await stat(item.path).catch(()=>undefined))?.isFile())throw new Error('缺少本地运行库：'+item.name)
  }
  await env.use<Promise<void>>('download.batch',{items:files})
 }
})
