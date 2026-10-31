import {describe,it,expect} from 'vitest'
import {compatibleVersions,checkedUpdateInput,updateLabel} from '../src/console/native/mods/model'
describe('native content operations preserve instance and update boundaries',()=>{
 it('offers only current game and loader compatible builds',()=>{const builds=[{gameVersions:['1.20.1'],loaders:['fabric'],id:'right'},{gameVersions:['1.21'],loaders:['fabric'],id:'wrong-game'},{gameVersions:['1.20.1'],loaders:['forge'],id:'wrong-loader'}] as any;expect(compatibleVersions(builds,'1.20.1','fabric').map(v=>v.id)).toEqual(['right'])})
 it('does not install loader-only mods into a vanilla instance',()=>{expect(compatibleVersions([{gameVersions:['1.20.1'],loaders:['fabric']}] as any,'1.20.1','')).toEqual([])})
 it('does not label unknown or failed updates as current',()=>{expect(updateLabel({status:'unknown'} as any)).toContain('未识别');expect(updateLabel({status:'error',error:{message:'网络错误'}} as any)).toContain('网络错误');expect(updateLabel({status:'current'} as any)).toContain('已核对')})
 it('requires a checked server proposal and binds it to the selected instance',()=>{expect(checkedUpdateInput('one',{status:'update',updateId:'proposal',diskName:'sodium.jar.disabled'} as any)).toEqual({id:'one',updateId:'proposal',diskName:'sodium.jar.disabled'});expect(()=>checkedUpdateInput('one',{status:'unknown',updateId:'fake'} as any)).toThrow();expect(()=>checkedUpdateInput('one',{status:'update'} as any)).toThrow()})
})
