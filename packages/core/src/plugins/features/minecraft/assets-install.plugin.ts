import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RawVersionJson, RhPaths } from '../../../contracts.ts'
import { identifier, object } from '../../http-input.ts'
import { readFile } from 'node:fs/promises'
import { assetIndexFile,buildInstallPlan,parseAssetIndex } from '../../../meta/install.ts'
import { currentEnvironment } from '../../../meta/rules.ts'
import type { Settings } from '../../../types.ts'
/** Install one version's resource index and content-addressed objects. */
export default defineFeature<{version:RawVersionJson},Promise<void>>({
 id:'minecraft.assets.install',capability:'minecraft.assets.install',title:'安装游戏资源',depends:['paths.get','settings.resolve','download.file','download.batch'],
 async execute(input,env){
  const paths=env.use<RhPaths>('paths.get')
  const entry=assetIndexFile(input.version,paths.assets)
  if(!entry)return
  identifier(input.version.assetIndex?.id,'资源索引 id')
  await env.use<Promise<number>>('download.file',entry)
  const index=parseAssetIndex(JSON.parse(await readFile(entry.destination,'utf8')))
  if(!index)throw new Error('资源索引格式不正确')
  for(const object of Object.values(index.objects))if(!/^[a-f0-9]{40}$/i.test(object.hash)||!Number.isSafeInteger(object.size)||object.size<0)throw new Error('资源索引含非法哈希或大小')
  const settings=env.use<Settings>('settings.resolve')
  const files=buildInstallPlan(input.version,paths,currentEnvironment(),index,settings.mirrors.assets).files.filter(file=>file.group==='asset')
  await env.use<Promise<void>>('download.batch',{items:files})
 }
})
