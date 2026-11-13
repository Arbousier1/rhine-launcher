import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RhPaths } from '../contracts.ts'
import { record, text } from './feature.ts'
import { currentOriginalCaller } from './caller.ts'
export interface CompatibilityData {
  settings: Record<string, unknown>
  instances: Record<string, Record<string, unknown>>
  themes: unknown[]
  collections: unknown[]
  currentTheme?: unknown
  customCss?: string
}
export interface OriginalStateRecord {
  id: string; key: string; type: string; feature: string; args: unknown[]
  snapshot: Record<string, unknown>; restore: string; renderers: Set<string>
}
interface Store { file?: string; data?: CompatibilityData; loading?: Promise<CompatibilityData>; states: Map<string, OriginalStateRecord>; ids: Map<string, string>; registered:Set<(value:OriginalStateRecord)=>void>; removed:Set<(value:OriginalStateRecord)=>void> }
export function store(env: FeatureEnvironment): Store {
  return env.state<Store>('ellan.compatibility.state', () => ({ states: new Map(), ids: new Map(), registered:new Set(), removed:new Set() }))
}
export async function compatibility(env: FeatureEnvironment): Promise<CompatibilityData> {
  const state = store(env)
  if (state.data) return state.data
  if (!state.loading) state.loading = (async () => {
    const paths = env.use<RhPaths>('paths.get')
    state.file = join(paths.root, '.rhine', 'ellan-ui.json')
    const fallback = { settings: {}, instances: {}, themes: [], collections: [] }
    const input = await env.use<Promise<unknown>>('storage.read', { file: state.file, fallback })
    const saved = record(input, 'compatibility data')
    const data: CompatibilityData = {
      settings: record(saved.settings ?? {}, 'original settings'), instances: record(saved.instances ?? {}, 'original instances') as Record<string, Record<string, unknown>>,
      themes: Array.isArray(saved.themes) ? saved.themes : [], collections: Array.isArray(saved.collections) ? saved.collections : [],
      currentTheme: saved.currentTheme, customCss: typeof saved.customCss === 'string' ? saved.customCss : '',
    }
    state.data = data
    return data
  })()
  return state.loading
}
export async function persist(env: FeatureEnvironment) {
  const state = store(env), data = await compatibility(env)
  await env.use('storage.write', { file: state.file, value: data })
}
export function shared(env: FeatureEnvironment, key: string, type: string, feature: string, args: unknown[], snapshot: Record<string, unknown>, restore: string) {
  const state = store(env)
  let value = state.states.get(key)
  if (!value) { value = { id: randomUUID(), key, type, feature, args, snapshot, restore, renderers: new Set() }; state.states.set(key, value); state.ids.set(value.id, key) }
  else { value.args = args; value.snapshot = snapshot }
  const renderer = currentOriginalCaller()
  if (renderer) value.renderers.add(renderer)
  for (const notify of state.registered) notify(value)
  return { __state__: type, id: value.id, ...structuredClone(snapshot) }
}
export function findState(env: FeatureEnvironment, id: unknown): OriginalStateRecord {
  const state = store(env), key = state.ids.get(text(id, 'state id')), value = key ? state.states.get(key) : undefined
  if (!value) throw new Error('Unknown original shared state')
  return value
}
export function emitOriginal(env: FeatureEnvironment, channel: string, args: unknown[]) {
  env.use('events.emit', { type: 'ellan', channel, args })
}
export function restoreState(env: FeatureEnvironment, value: OriginalStateRecord, previous: Record<string, unknown> = {}) {
  let payload: unknown = value.snapshot
  if (value.type === 'InstanceState') payload = value.snapshot.instances
  if (value.type === 'JavaState') {
    const old=Array.isArray(previous.all)?previous.all:[], next=Array.isArray(value.snapshot.all)?value.snapshot.all:[]
    const paths=new Set(next.map(v=>typeof v==='object'&&v?Reflect.get(v,'path'):undefined))
    for(const record of old)if(record&&typeof record==='object'&&!paths.has(Reflect.get(record,'path')))emitOriginal(env,'commit',[value.id,'javaRemove',record])
    payload = next
  }
  if (value.type === 'LocalVersions') payload = value.snapshot.local
  if (value.type === 'Saves') payload = value.snapshot.saves
  if (value.type === 'InstanceModsGroupState') payload = value.snapshot.groups
  if (value.type === 'ServerInfoState') payload = value.snapshot.serverInfos
  if (value.type === 'ResourceState') {
    const old=Array.isArray(previous.files)?previous.files:[], next=Array.isArray(value.snapshot.files)?value.snapshot.files:[]
    const paths=new Set(next.map(v=>typeof v==='object'&&v?Reflect.get(v,'path'):undefined))
    payload=[...old.filter(v=>v&&typeof v==='object'&&!paths.has(Reflect.get(v,'path'))).map(v=>[Reflect.get(v,'path'),1]),...next.map(v=>[v,0])]
  }
  emitOriginal(env, 'commit', [value.id, value.restore, payload])
  if(value.type==='ResourceState'){
   const old=Array.isArray(previous.errors)?previous.errors:[],next=Array.isArray(value.snapshot.errors)?value.snapshot.errors:[]
   const paths=new Set(next.map(v=>v&&typeof v==='object'?Reflect.get(v,'path'):undefined))
   const operations=[...old.filter(v=>v&&typeof v==='object'&&!paths.has(Reflect.get(v,'path'))).map(v=>[Reflect.get(v,'path'),1]),...next.map(v=>[v,0])]
   emitOriginal(env,'commit',[value.id,'errorsUpdates',operations])
  }
}
export function dropState(env:FeatureEnvironment,key:string){
  const cache=store(env),value=cache.states.get(key)
  if(!value)return
  cache.states.delete(key);cache.ids.delete(value.id)
  for(const notify of cache.removed)notify(value)
}
export function releaseRenderer(env: FeatureEnvironment, rendererId: string) {
  const cache=store(env)
  for(const [key,value]of cache.states){value.renderers.delete(rendererId);if(value.renderers.size===0)dropState(env,key)}
}
