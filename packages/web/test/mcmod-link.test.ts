import {describe,it,expect} from 'vitest'
import {mcmodLink,wikiSearchTerm,wikiSearchUrl} from '../src/features/mods/mcmod'
describe('MC encyclopedia links follow PCL2 behaviour',()=>{
 it('links directly to a known entry id',()=>{expect(mcmodLink({name:'JEI',wikiId:170})).toEqual({kind:'entry',url:'https://www.mcmod.cn/class/170.html',label:'MC 百科'})})
 it('falls back to encyclopedia search and never invents an id',()=>{const link=mcmodLink({name:'Sodium'});expect(link.kind).toBe('search');expect(link.url).toBe('https://www.mcmod.cn/s?key=Sodium&site=all&filter=0')})
 it('rejects non-positive or non-integer ids',()=>{for(const id of [0,-5,1.5,NaN,null,undefined])expect(mcmodLink({name:'X',wikiId:id as never}).kind).toBe('search')})
 it('splits CamelCase the way a player would search',()=>{expect(wikiSearchTerm('OptiFine')).toBe('Opti+Fine');expect(wikiSearchTerm('create_stuff')).toBe('create+stuff');expect(wikiSearchTerm('Sodium')).toBe('Sodium')})
 it('keeps Chinese names intact in the search url',()=>{expect(wikiSearchUrl('机械动力')).toContain(encodeURIComponent('机械动力'))})
})
