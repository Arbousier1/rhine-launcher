import {afterEach,describe,it,expect,vi} from 'vitest'
import {FeatureRuntime} from '@rhine/plugin-api'
import {defineFeature} from '@rhine/plugin-api'
import {contributeSurface,listSurfaces,subscribeSurfaces} from '../src/console/default-ui/slots'
import {t,hasMessage} from '../src/console/default-ui/locale'
afterEach(()=>vi.unstubAllGlobals())

describe('DSH-style surface slot and locale',()=>{
 it('registers one surface per capability and sorts by order',async()=>{
  const runtime=new FeatureRuntime()
  runtime.register(defineFeature({id:'surface.settings',capability:'surface.settings',title:'设置',setup:env=>contributeSurface(env,{capability:'surface.settings',labelKey:'nav.settings',order:30}),execute(){}}))
  runtime.register(defineFeature({id:'surface.instances',capability:'surface.instances',title:'实例',setup:env=>contributeSurface(env,{capability:'surface.instances',labelKey:'nav.instances',order:10}),execute(){}}))
  runtime.register(defineFeature({id:'surface.downloads',capability:'surface.downloads',title:'下载',setup:env=>contributeSurface(env,{capability:'surface.downloads',labelKey:'nav.downloads',order:20}),execute(){}}))
  await runtime.start()
  try{expect(listSurfaces(runtime as never).map(s=>s.capability)).toEqual(['surface.instances','surface.downloads','surface.settings'])}finally{await runtime.dispose()}
 })
 it('removes a surface when its feature unloads, without touching siblings',async()=>{
  const runtime=new FeatureRuntime()
  for(const [id,order]of [['surface.instances',10],['surface.downloads',20]] as const){
   runtime.register(defineFeature({id,capability:id,title:id,setup:env=>contributeSurface(env,{capability:id,labelKey:'nav.'+id,order}),execute(){}}))
  }
  await runtime.start()
  try{
   expect(listSurfaces(runtime as never)).toHaveLength(2)
   await runtime.disable('surface.downloads')
   expect(listSurfaces(runtime as never).map(s=>s.capability)).toEqual(['surface.instances'])
  }finally{await runtime.dispose()}
 })
 it('notifies subscribers on contribution and removal',async()=>{
  const runtime=new FeatureRuntime()
  runtime.register(defineFeature({id:'surface.instances',capability:'surface.instances',title:'实例',setup:env=>contributeSurface(env,{capability:'surface.instances',labelKey:'nav.instances',order:10}),execute(){}}))
  await runtime.start()
  const seen=vi.fn()
  const off=subscribeSurfaces(runtime as never,seen)
  try{await runtime.disable('surface.instances');expect(seen).toHaveBeenCalled()}finally{off();await runtime.dispose()}
 })
 it('resolves locale keys with substitution and reports unknown keys',()=>{
  expect(t('nav.instances')).toBe('游戏实例')
  expect(t('launch.preparing')).toBe('正在准备启动…')
  expect(t('instances.deleteConfirm','测试实例')).toContain('测试实例')
  expect(hasMessage('nav.downloads')).toBe(true)
  expect(hasMessage('nav.nonexistent')).toBe(false)
  expect(t('nav.nonexistent')).toBe('nav.nonexistent')
 })
})
