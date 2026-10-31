import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineFeature, type FeatureCatalogEntry } from '@rhine/plugin-api'

/** Discover descriptors from disk. A catalog is data, never a bulk feature plugin. */
export async function discoverFeatures(directory = fileURLToPath(new URL('./features',import.meta.url))):Promise<FeatureCatalogEntry[]> {
  const entries:FeatureCatalogEntry[]=[]
  async function walk(dir:string):Promise<void>{
    const paths=await readdir(dir,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error})
    for(const item of paths.sort((a,b)=>a.name.localeCompare(b.name))){
      const file=join(dir,item.name)
      if(item.isDirectory())await walk(file)
      else if(/^[^.].*[.]plugin[.](ts|js|mjs)$/.test(item.name)){
        const module=await import(pathToFileURL(file).href)
        if(!module.default)throw new Error('插件文件必须 default export 单个 descriptor：'+file)
        entries.push({plugin:defineFeature(module.default),source:file})
      }
    }
  }
  await walk(directory)
  return entries
}
