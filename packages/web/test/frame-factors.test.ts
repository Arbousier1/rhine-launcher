import {describe,it,expect} from 'vitest'
import {frameFactors} from '../src/console/frame-factors'
import {settlingWave,columnStrength} from '../src/console/motion'
describe('per-frame factor reuse is not an animation approximation',()=>{
 it('retains exact original values across rebased rows, lanes and half-row samples',()=>{for(const shoulder of [-200,-1,0,12.45,1e5])for(const focus of [-10,0,1.9,5,100]){const frame=frameFactors(shoulder,focus);for(let row=-32;row<80;row+=.5)for(let lane=-5;lane<=9;lane++){const original=settlingWave(row-shoulder,26.56)*columnStrength(lane,focus);expect(frame.shoulder(row)*frame.strength(lane)).toBe(original);expect(Math.fround(frame.shoulder(row)*frame.strength(lane))).toBe(Math.fround(original))}}})
 it('does not reuse time-dependent shoulder or lane values across frames',()=>{const a=frameFactors(12,1),b=frameFactors(12.5,2);expect(a.shoulder(12)).not.toBe(b.shoulder(12));expect(a.strength(1)).not.toBe(b.strength(1))})
})
