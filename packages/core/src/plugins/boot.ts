import { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FeatureRuntime } from '@rhine/plugin-api'
import type { RhContext } from '../contracts.ts'
import { defaultDataDir } from '../services/paths.ts'
import { discoverFeatures } from './catalog.ts'
import { installProjections } from './facades.ts'

export interface LauncherOptions { root?:string; disabled?:readonly string[]; pluginsDir?:string }
const BASE_PREFIXES=['paths.','storage.','settings.','events.','task.','download.']

/** Kernel creation only: no bundled services and no loader/provider business switches. */
export async function createHost(context:Context,options:LauncherOptions={}):Promise<RhContext>{
  if(context.reflect.get('features'))return context as RhContext
  const runtime=new FeatureRuntime(context)
  runtime.seedState('core.options',{root:options.root??defaultDataDir()})
  installProjections(runtime)
  for(const entry of await discoverFeatures())runtime.register(entry.plugin,entry.source)
  if(options.pluginsDir)for(const entry of await discoverFeatures(options.pluginsDir))runtime.register(entry.plugin,entry.source)
  return context as RhContext
}

/** Test/embedding helper: only install the independent platform dependency closure. */
export async function installCore(context:Context,options:LauncherOptions={}):Promise<Context>{
  const ctx=await createHost(context,options)
  for(const item of ctx.features.definitions())if(BASE_PREFIXES.some(prefix=>item.id.startsWith(prefix)))await ctx.features.enable(item.id)
  return ctx
}

/** Enable a set of single-capability descriptors, not a multi-feature plugin. */
export async function installCapabilities(context:Context,ids:readonly string[]):Promise<void>{
  const ctx=await createHost(context)
  for(const id of ids)await ctx.features.enable(id)
}

/** Compose all registered features from configuration. */
export async function createLauncherContext(options:LauncherOptions={}):Promise<RhContext>{
  const ctx=await createHost(new Context(),options)
  let disabled=options.disabled
  let entries: import('@rhine/plugin-api').FeatureConfigurationEntry[]|undefined
  if(!disabled){
    try{const config=JSON.parse(await readFile(join(options.root??defaultDataDir(),'plugins.json'),'utf8'));if(Array.isArray(config.disabled))disabled=config.disabled.filter((id:unknown)=>typeof id==='string');if(Array.isArray(config.entries))entries=config.entries}
    catch(error:any){if(error.code!=='ENOENT')throw error}
  }
  await ctx.features.start({disabled,entries})
  if(ctx.features.has('paths.ensure'))await ctx.paths.ensure()
  return ctx
}
