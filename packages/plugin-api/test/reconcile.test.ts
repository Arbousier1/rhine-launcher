import {describe,it,expect} from 'vitest'
import {FeatureRuntime,defineFeature} from '../src/index.ts'

function plugin(id:string,value:number,seen:string[]){return defineFeature({id,capability:id,title:id,execute:()=>value,setup:env=>{seen.push('load:'+id+':'+value);env.onDispose(()=>{seen.push('unload:'+id+':'+value)})}})}

describe('paper section 5.2: reconciliation by stable entry identity',()=>{
 it('late providers reactivate previously blocked consumers',async()=>{
  const r=new FeatureRuntime()
  r.register(defineFeature({id:'consumer',capability:'consumer',title:'consumer',depends:['provider'],execute:(_input,env)=>env.use('provider')}))
  await r.start();expect(r.get('consumer')?.status).toBe('blocked')
  r.register(defineFeature({id:'provider',capability:'provider',title:'provider',execute:()=>42}))
  await r.settled()
  expect(r.call('consumer')).toBe(42)
  await r.dispose()
 })
 it('replaces a provider and required consumers but not independent siblings',async()=>{
  const seen:string[]=[];const r=new FeatureRuntime()
  r.register(plugin('provider',1,seen));r.register(plugin('unrelated',9,seen))
  r.register(defineFeature({id:'consumer',capability:'consumer',title:'consumer',depends:['provider'],execute:(_input,env)=>env.use('provider'),setup:env=>{seen.push('consumer.load');env.onDispose(()=>{seen.push('consumer.unload')})}}))
  await r.start();seen.length=0
  await r.replace('provider',plugin('provider',2,seen))
  expect(r.call('consumer')).toBe(2)
  expect(r.call('unrelated')).toBe(9)
  expect(seen).not.toContain('unload:unrelated:9')
  expect(seen.indexOf('consumer.unload')).toBeLessThan(seen.indexOf('unload:provider:1'))
  await r.dispose()
 })
 it('bad replacement rolls back to the old working composition',async()=>{
  const seen:string[]=[];const r=new FeatureRuntime()
  r.register(plugin('provider',1,seen));r.register(plugin('unrelated',9,seen))
  await r.start();seen.length=0
  await expect(r.replace('provider',defineFeature({id:'provider',capability:'provider',title:'broken',execute:()=>2,setup:env=>{env.onDispose(()=>{seen.push('broken.cleaned')});throw new Error('bad replacement')}}))).rejects.toThrow('bad replacement')
  expect(r.call('provider')).toBe(1)
  expect(r.call('unrelated')).toBe(9)
  expect(seen).toContain('broken.cleaned')
  expect(seen).not.toContain('unload:unrelated:9')
  await r.dispose()
 })
 it('invalid configuration is rejected before unloading any working component',async()=>{
  const seen:string[]=[];const r=new FeatureRuntime()
  r.register(defineFeature({...plugin('configurable',1,seen),Config:{'~standard':{validate:value=>typeof value==='number'&&value>0?{value}:{issues:[{message:'must be positive'}]}}}}))
  await r.start({entries:[{id:'configurable',config:1}]});seen.length=0
  await expect(r.reconcile([{id:'configurable',config:-1}])).rejects.toThrow('must be positive')
  expect(r.call('configurable')).toBe(1)
  expect(seen).toEqual([])
  await r.dispose()
 })
 it('semantically unchanged configuration does not restart a fiber',async()=>{
  const seen:string[]=[];const r=new FeatureRuntime()
  r.register(plugin('settings',1,seen))
  await r.start({entries:[{id:'settings',config:{a:1,b:2}}]});seen.length=0
  await r.reconcile([{id:'settings',config:{b:2,a:1}}])
  expect(seen).toEqual([])
  await r.dispose()
 })
 it('config changes are visible through the same contextual effect mechanism',async()=>{
  const seen:string[]=[];const r=new FeatureRuntime()
  r.register(defineFeature({...plugin('settings',1,seen),execute:(_input,env)=>env.config}))
  r.register(plugin('unrelated',9,seen))
  await r.start({entries:[{id:'settings',config:{mode:'a'}}]});seen.length=0
  await r.reconcile([{id:'settings',config:{mode:'b'}}])
  expect(r.call('settings')).toEqual({mode:'b'})
  expect(seen.filter(item=>item.includes('unrelated'))).toEqual([])
  await r.dispose()
 })
 it('component state initialization failure rolls back config and effects',async()=>{
  const r=new FeatureRuntime();let release=0
  r.register(defineFeature({id:'settings',capability:'settings',title:'settings',execute:(_input,env)=>env.config,setup:env=>{env.onDispose(()=>{release++});if(env.config==='broken')throw new Error('broken')}}))
  await r.start({entries:[{id:'settings',config:'working'}]})
  await expect(r.reconcile([{id:'settings',config:'broken'}])).rejects.toThrow('broken')
  expect(r.call('settings')).toBe('working')
  expect(release).toBe(2)
  await r.dispose()
 })
 it('unload removes runtime acquisitions but preserves committed business data',async()=>{
  const committed=new Map<string,string>();let listeners=0;const r=new FeatureRuntime()
  r.register(defineFeature({id:'install',capability:'install',title:'install',execute:()=>{committed.set('world','user save')},setup:env=>{listeners++;env.onDispose(()=>{listeners--})}}))
  await r.start();r.call('install')
  await r.disable('install')
  expect(listeners).toBe(0)
  expect(committed.get('world')).toBe('user save')
  await r.dispose()
 })
})
// Context access stays valid during registered inverses, not after removal.
it('keeps required providers accessible while a dependent inverse runs',async()=>{
 const r=new FeatureRuntime();let observed=0;let late:(()=>unknown)|undefined
 r.register(defineFeature({id:'provider',capability:'provider',title:'provider',execute:()=>17}))
 r.register(defineFeature({id:'consumer',capability:'consumer',title:'consumer',depends:['provider'],execute:()=>undefined,setup:env=>{late=()=>env.use('provider');env.onDispose(async()=>{await Promise.resolve();observed=env.use<number>('provider')})}}))
 await r.start()
 await r.disable('provider')
 expect(observed).toBe(17)
 expect(()=>late?.()).toThrow()
 await r.dispose()
})
