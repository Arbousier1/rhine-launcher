import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { Settings } from '../types.ts'
import { ModrinthClient } from '../market/modrinth.ts'
import { CurseForgeClient } from '../market/curseforge.ts'
import { resolveCurseforgeApiKey } from '../config/secrets.ts'
/** HTTP protocol helpers are per invocation and never retain a sibling feature's signal. */
function scopedFetch(env:FeatureEnvironment):typeof fetch {return (input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([env.signal,init.signal]):env.signal})}
export function modrinthClient(env:FeatureEnvironment):ModrinthClient {
 const settings=env.use<Settings>('settings.resolve')
 return new ModrinthClient({baseUrl:settings.mirrors.modrinth,fetch:scopedFetch(env)})
}
export function curseforgeClient(env:FeatureEnvironment):CurseForgeClient {
 const settings=env.use<Settings>('settings.resolve')
 const apiKey=resolveCurseforgeApiKey(settings.curseforgeApiKey).value
 return new CurseForgeClient({baseUrl:settings.mirrors.curseforge,apiKey,fetch:scopedFetch(env)})
}
