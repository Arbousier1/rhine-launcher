import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { Account,Settings } from '../types.ts'
import { resolveCurseforgeApiKey, resolveMicrosoftClientId } from '../config/secrets.ts'

export function publicAccount(account:Account):Record<string,unknown>{
 const {accessToken,refreshToken,clientToken,...rest}=account
 return rest
}
export function publicSettings(settings:Settings):Record<string,unknown>{
 const {curseforgeApiKey,proxy,...rest}=settings
 const cf=resolveCurseforgeApiKey(curseforgeApiKey)
 const ms=resolveMicrosoftClientId(settings.microsoftClientId)
 return {
  ...rest,
  curseforgeApiKey:undefined,
  hasCurseforgeApiKey:Boolean(cf.value),
  curseforgeKeyOrigin:cf.origin,
  // Only the *origin* is public; an env-provided ID is still safe to expose
  // because a public client ID appears in every authorize URL anyway.
  microsoftClientIdFromEnv:ms.origin==='env',
  microsoftClientIdConfigured:Boolean(ms.value),
  proxy:proxy?{...proxy,password:undefined,hasPassword:Boolean(proxy.password)}:undefined,
 }
}
export function featureHealth(env:FeatureEnvironment):Record<string,unknown>{
 const plugins=env.context.features.list()
 const groups:Record<string,boolean>={}
 for(const plugin of plugins){const group=plugin.id.split('.')[0];groups[group]=(groups[group]??true)&&plugin.status==='enabled'}
 for(const [alias,group]of Object.entries({instances:'instance',accounts:'account',tasks:'task',meta:'version'}))groups[alias]=groups[group]??false
 return {ok:plugins.every(plugin=>plugin.status==='enabled'||plugin.status==='disabled'),app:'Rhine Launcher',version:'0.2.0',pid:process.pid,platform:process.platform,node:process.versions.node,services:groups,plugins}
}
