import { arch, freemem, platform, release, totalmem } from 'node:os'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, lstat, realpath } from 'node:fs/promises'
import { parseOriginalOptions, readOriginalServers, readOriginalWorld } from '@rhine/ellan-ui/game-data'
import { join, resolve } from 'node:path'
import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { originalDefaults } from '@rhine/ellan-ui/defaults'
import { toOriginalInstance, toOriginalUser, toOriginalJava, toOriginalSettings } from '@rhine/ellan-ui/projections'
import { parseOriginalVersion, originalVersionHeader, type OriginalVersionHeader } from '@rhine/ellan-ui/node-runtime'
import type { Account, Bootstrap, Instance, JavaRuntime, Settings, LaunchSession } from '../types.ts'
import type { RhPaths } from '../contracts.ts'
import { type OriginalCall, record, text } from './feature.ts'
import { compatibility, shared } from './state.ts'
import { scanResourceDirectory } from './resource-state.ts'
const clone = <T>(value: T): T => structuredClone(value)
export const COMMON = ['paths.get', 'storage.read', 'events.emit'] as const
export async function findInstance(env: FeatureEnvironment, path: unknown): Promise<Instance> {
  const requested = resolve(text(path, 'instance path'))
  const instances = await env.use<Promise<Instance[]>>('instance.list')
  const instance = instances.find(i => resolve(i.path).toLowerCase() === requested.toLowerCase())
  if (!instance) throw new FeatureError('INSTANCE_NOT_FOUND', 'Instance is not registered in this launcher', 404)
  return instance
}
export async function settingsState(input: OriginalCall, env: FeatureEnvironment) {
  const settings = await env.use<Promise<Settings>>('settings.get')
  const saved = await compatibility(env)
  const value = { ...toOriginalSettings(settings, clone(originalDefaults.Settings), { databaseReady: true }), ...saved.settings }
  value.disableTelemetry = true // No external telemetry provider is configured for this host.
  // Offline x://dev is implemented by core accounts, not a local Yggdrasil server.
  // Do not ask the renderer to fabricate a local authlib agent endpoint.
  if (!('globalDisableAuthlibInjector' in saved.settings)) value.globalDisableAuthlibInjector = true
  return shared(env, 'Settings', 'Settings', 'ellan.base.settings', input.args, value, 'config')
}
export async function environment(_input: OriginalCall, env: FeatureEnvironment) {
  const bootstrap = await env.use<Promise<Bootstrap>>('bootstrap')
  return { os: platform(), osRelease: release(), arch: arch(), env: {}, version: bootstrap.app.version,
    build: bootstrap.app.version, region: '', steamDeck: false }
}
export function memoryStatus() { return { total: totalmem(), free: freemem() } }
export function dataDirectory(_input: OriginalCall, env: FeatureEnvironment) { return env.use<RhPaths>('paths.get').root }
export async function networkStatus(_input: OriginalCall, env: FeatureEnvironment) {
  const tasks = await env.use<Promise<unknown[]>>('task.list')
  // The current downloader does not expose per-connection telemetry.
  return { downloadSpeed: 0, pools: [], runningTasks: tasks.length }
}
export async function userState(input: OriginalCall, env: FeatureEnvironment) {
  const accounts = await env.use<Promise<Account[]>>('account.list')
  const users = Object.fromEntries(accounts.map(a => { const u = toOriginalUser(a); return [u.id, u] }))
  return shared(env, 'UserState', 'UserState', 'ellan.user.state', input.args, { users }, 'userData')
}
export async function authorities(_input: OriginalCall, env: FeatureEnvironment) {
  const settings = await env.use<Promise<Settings>>('settings.get')
  return [
    { authority: 'x://dev', name: '离线', authService: 'offline', supportsProfileCreation: true },
    { authority: 'x://microsoft', name: '微软', authService: 'microsoft', configured: Boolean(settings.microsoftClientId) },
  ]
}
export async function instancesState(input: OriginalCall, env: FeatureEnvironment) {
  const instances = await env.use<Promise<Instance[]>>('instance.list')
  const saved = await compatibility(env)
  const values = instances.map(i => {
    const projected=toOriginalInstance(i),extra=saved.instances[i.id]??{}
    return {...projected,...extra,name:projected.name,path:projected.path,java:projected.java,minMemory:projected.minMemory,maxMemory:projected.maxMemory,vmOptions:projected.vmOptions,mcOptions:projected.mcOptions,resolution:projected.resolution,runtime:{...(typeof extra.runtime==='object'&&extra.runtime?extra.runtime:{}),...projected.runtime},creationDate:projected.creationDate,lastAccessDate:projected.lastAccessDate,playtime:projected.playtime}
  })
  return shared(env, 'InstanceState', 'InstanceState', 'ellan.instance.state', input.args,
    { all: Object.fromEntries(values.map(i => [i.path, i])), instances: values, groups: [] }, 'instanceRestore')
}
export async function javaState(input: OriginalCall, env: FeatureEnvironment) {
  const cache = env.state<{ records?: JavaRuntime[]; pending?: Promise<JavaRuntime[]> }>('ellan.java.probed', () => ({}))
  if (!cache.records) {
    cache.pending ??= env.use<Promise<JavaRuntime[]>>('java.scan')
    cache.records = await cache.pending
  }
  return shared(env, 'JavaState', 'JavaState', 'ellan.java.state', input.args, { all: cache.records.map(j => toOriginalJava(j, true)) }, 'javaUpdate')
}
export async function localVersions(input: OriginalCall, env: FeatureEnvironment) {
  const directory = env.use<RhPaths>('paths.get').root
  const ids = await env.use<Promise<string[]>>('version.installed')
  const local: OriginalVersionHeader[] = []
  for (const id of ids) {
    try { local.push(originalVersionHeader(await parseOriginalVersion(directory, id))) }
    catch (error) { /* Unparseable versions are not presented as healthy installed versions. */ }
  }
  return shared(env, 'VersionState', 'LocalVersions', 'ellan.version.state', input.args, { local, servers: [] }, 'localVersions')
}
export async function resolveVersion(input: OriginalCall, env: FeatureEnvironment) {
  const id = text(input.args[0], 'version id')
  const installed = await env.use<Promise<string[]>>('version.installed')
  if (!installed.includes(id)) return undefined
  return parseOriginalVersion(env.use<RhPaths>('paths.get').root, id)
}
export async function gameProcesses(_input: OriginalCall, env: FeatureEnvironment) {
  const sessions = await env.use<Promise<LaunchSession[]>>('session.list')
  const instances = await env.use<Promise<Instance[]>>('instance.list')
  return sessions.filter(s => s.status === 'running' || s.status === 'starting').map(s => ({
    pid: s.pid, launchId: s.id, ready: s.status === 'running', side: 'client',
    options: { gameDirectory: instances.find(i => i.id === s.instanceId)?.path, user: { username: s.accountName } },
  }))
}
export async function currentTheme(_input: OriginalCall, env: FeatureEnvironment) { return (await compatibility(env)).currentTheme }
export async function storedThemes(_input: OriginalCall, env: FeatureEnvironment) { return (await compatibility(env)).themes }
export async function customCss(_input: OriginalCall, env: FeatureEnvironment) { return (await compatibility(env)).customCss ?? '' }
export async function localCollections(input: OriginalCall, env: FeatureEnvironment) {
  return shared(env, 'LocalCollectionState', 'LocalCollectionState', 'ellan.collection.state', input.args,
    { ...clone(originalDefaults.LocalCollectionState), collections: (await compatibility(env)).collections }, 'collections')
}
export function xmclAccount(input: OriginalCall, env: FeatureEnvironment) {
  return shared(env, 'XmclAccountState', 'XmclAccountState', 'ellan.account.state', input.args,
    clone(originalDefaults.XmclAccountState), 'account')
}
export function agentSettings() { return { endpoint: '', model: '', configured: false, mode: 'runtime' } }
export function agentConversation(input: OriginalCall) {
  const options = record(input.args[0])
  return { messages: [], context: [], scope: typeof options.scope === 'string' ? options.scope : '', configured: false }
}
export function bedrockSupported() { return false }
export async function validatePath(input: OriginalCall, env: FeatureEnvironment) { await findInstance(env, input.args[0]); return undefined }
export async function instanceTheme(input: OriginalCall, env: FeatureEnvironment) {
  const instance = await findInstance(env, input.args[0]), saved = await compatibility(env)
  return saved.instances[instance.id]?.theme
}
async function listDirectory(path: string) {
  try { return await readdir(path, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
export async function screenshots(input: OriginalCall, env: FeatureEnvironment) {
  const instance = await findInstance(env, input.args[0])
  const folder = join(instance.path, 'screenshots'), files = await listDirectory(folder)
  return Promise.all(files.filter(f => f.isFile() && /[.](png|jpg|jpeg|webp)$/i.test(f.name)).map(async f => {
    const path = join(folder, f.name), info = await stat(path)
    return { name: f.name, path, size: info.size, time: info.mtimeMs, url: 'http://launcher/media?path=' + encodeURIComponent(path) }
  }))
}
export async function optionsState(input: OriginalCall, env: FeatureEnvironment) {
  const instance=await findInstance(env,input.args[0])
  let options:Record<string,unknown>={}
  try{options=parseOriginalOptions(await readFile(join(instance.path,'options.txt'),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  let eula=false
  try{eula=/(?:^|\n)eula=true(?:\r?\n|$)/.test(await readFile(join(instance.path,'eula.txt'),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  const value={...clone(originalDefaults.GameOptionsState),...options,eula}
  return shared(env,'Options:'+instance.id,'GameOptionsState','ellan.options.watch',input.args,value,'gameOptionsSet')
}
export async function resourcesState(input: OriginalCall, env: FeatureEnvironment, folder: string, feature: string) {
  const instance=await findInstance(env,input.args[0])
  if(folder!=='mods'&&folder!=='resourcepacks'&&folder!=='shaderpacks')throw new FeatureError('INVALID_RESOURCE_FOLDER','资源目录无效',400)
  const snapshot=await scanResourceDirectory(env,instance,folder)
  return shared(env,folder+':'+instance.id,'ResourceState',feature,input.args,{files:snapshot.files,errors:snapshot.errors},'filesUpdates')
}
export async function savesState(input: OriginalCall, env: FeatureEnvironment) {
  const instance=await findInstance(env,input.args[0])
  const saves=await loadSaves(join(instance.path,'saves'),instance.name,env)
  return shared(env,'Saves:'+instance.id,'Saves','ellan.saves.watch',input.args,{saves},'instanceSaves')
}
async function loadSaves(folder:string,instanceName:string,env:FeatureEnvironment){
  const entries=await listDirectory(folder),saves:Record<string,unknown>[]=[]
  for(const entry of entries){
    if(!entry.isDirectory()&&!entry.isSymbolicLink())continue
    const path=join(folder,entry.name)
    try{
      const data=await readOriginalWorld(path)
      const version=data.Version&&typeof data.Version==='object'?Reflect.get(data.Version,'Name'):undefined
      const settings=data.WorldGenSettings&&typeof data.WorldGenSettings==='object'?Reflect.get(data.WorldGenSettings,'seed'):undefined
      const image=join(path,'icon.png'),info=await lstat(path)
      const advancements=new Set<string>()
      for(const file of await listDirectory(join(path,'advancements'))){if(!file.isFile()||!file.name.endsWith('.json'))continue;try{const content:Record<string,unknown>=JSON.parse(await readFile(join(path,'advancements',file.name),'utf8'));for(const [key,value]of Object.entries(content))if(value&&typeof value==='object'&&Reflect.get(value,'done')===true)advancements.add(key)}catch{/* Malformed optional advancement file is not counted. */}}
      saves.push({path,instanceName,name:entry.name,icon:(await stat(image).catch(()=>undefined))?.isFile()?'http://launcher/media?path='+encodeURIComponent(image):'',
        linkTo:info.isSymbolicLink()?await realpath(path):undefined,levelName:typeof data.LevelName==='string'?data.LevelName:entry.name,
        mode:data.GameType,cheat:Boolean(data.allowCommands),gameVersion:typeof version==='string'?version:'',difficulty:data.Difficulty,
        lastPlayed:Number(data.LastPlayed??0),time:Number(data.Time??0),advancements:advancements.size,seed:String(settings??data.RandomSeed??'')})
    }catch(error){env.use('events.emit',{type:'notice',level:'warn',message:'无法读取存档 '+entry.name+': '+(error instanceof Error?error.message:String(error))})}
  }
  return saves
}
export async function sharedSaves(_input:OriginalCall,env:FeatureEnvironment){return loadSaves(join(env.use<RhPaths>('paths.get').root,'saves'),'',env)}
export async function saveLinked(input:OriginalCall,env:FeatureEnvironment){const instance=await findInstance(env,input.args[0]);return(await lstat(join(instance.path,'saves')).catch(()=>undefined))?.isSymbolicLink()??false}
export async function serversState(input:OriginalCall,env:FeatureEnvironment){
 const instance=await findInstance(env,input.args[0]);let serverInfos:unknown[]=[]
 try{serverInfos=await readOriginalServers(await readFile(join(instance.path,'servers.dat')))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 return shared(env,'Servers:'+instance.id,'ServerInfoState','ellan.servers.watch',input.args,{serverInfos},'instanceServerInfos')
}
export async function installState(input: OriginalCall, env: FeatureEnvironment) {
  const instance = await findInstance(env, input.args[0])
  return shared(env, 'Install:' + instance.id, 'InstanceInstallStatus', 'ellan.install.watch', input.args,
    { ...clone(originalDefaults.InstanceInstallStatus), instance: instance.path }, 'update')
}
export async function backupConfig(_input: OriginalCall, env: FeatureEnvironment) {
  const saved = await compatibility(env)
  return saved.settings.autoBackup ?? { enabled: false }
}
export async function autoBackups(_input: OriginalCall, env: FeatureEnvironment) {
  const folder = join(env.use<RhPaths>('paths.get').root, 'backups')
  return (await listDirectory(folder)).filter(e => e.isDirectory()).map(e => ({ name: e.name, path: join(folder, e.name) }))
}
