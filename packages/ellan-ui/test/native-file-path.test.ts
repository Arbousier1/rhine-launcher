import {describe,it,expect,vi,afterEach} from 'vitest'
import {FeatureRuntime} from '@rhine/plugin-api'
import plugin,{actualNativeFilePath} from '../src/plugins/native-file-path.plugin.ts'
afterEach(()=>vi.unstubAllGlobals())
describe('original UI native file-path capability',()=>{
 it('uses the native host result, never file.name as a path, and restores controller on disposal',async()=>{
  const previous=()=>'',native=vi.fn((file:File)=>file.name==='selected.jar'?'E:/approved/selected.jar':'')
  const controller={getPathForFile:previous}
  const target={rhineDesktop:{nativeFilePath:native},windowController:controller,location:{protocol:'rhine-app:',host:'app'}}
  Reflect.set(target,'parent',target);vi.stubGlobal('window',target);vi.stubGlobal('document',{body:{}})
  const runtime=new FeatureRuntime();runtime.register(plugin)
  try{
   await runtime.start()
   const file=new File(['native-selected'],'selected.jar')
   expect(controller.getPathForFile(file)).toBe('E:/approved/selected.jar')
   expect(runtime.call('ui.files.native-path',file)).toBe('E:/approved/selected.jar')
   expect(actualNativeFilePath(new File(['browser'],'generated.jar'))).toBe('')
   await runtime.disable('ui.files.native-path');expect(controller.getPathForFile).toBe(previous)
   await runtime.enable('ui.files.native-path');expect(controller.getPathForFile(file)).toBe('E:/approved/selected.jar')
  }finally{await runtime.dispose()}
  expect(controller.getPathForFile).toBe(previous)
 })
 it('does not pretend a browser or foreign parent can supply absolute paths',()=>{
  const target={location:{protocol:'https:',host:'browser.example'},parent:{location:{protocol:'https:',host:'foreign.example'},rhineDesktop:{nativeFilePath:()=>'/fake'}}}
  vi.stubGlobal('window',target)
  expect(()=>actualNativeFilePath(new File([''],'generated.jar'))).toThrow('no native')
 })
})
