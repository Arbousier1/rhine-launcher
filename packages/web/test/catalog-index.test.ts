import {describe,it,expect} from 'vitest'
import {createCatalogIndex} from '../src/console/catalog-index'
describe('revision-owned catalog lookup',()=>{
 it('matches the old ordering/location rules with unequal interleaved columns',()=>{
  const columns=['原版','Fabric','Forge'],records=Array.from({length:103},(_,i)=>({category:columns[(i*7)%3]})),index=createCatalogIndex(records,columns)
  for(let lane=-30;lane<30;lane++)expect(index.column(lane)).toEqual(records.flatMap((r,i)=>r.category===columns[((lane%3)+3)%3]?[i]:[]))
  records.forEach((record,i)=>{const lane=columns.indexOf(record.category),row=12+index.column(lane).indexOf(i);expect(index.location(i)).toEqual({lane,row,slot:lane*32+row})})
 })
 it('does not rescan records or allocate new columns/locations during repeated lookups',()=>{
  let reads=0;const records=Array.from({length:10000},(_,i)=>({get category(){reads++;return '列'+(i%7)}})),index=createCatalogIndex(records,Array.from({length:7},(_,i)=>'列'+i));const built=reads
  const column=index.column(3),location=index.location(8751)
  for(let i=0;i<10000;i++){expect(index.column(3)).toBe(column);expect(index.location(8751)).toBe(location)}
  expect(reads).toBe(built)
 })
 it('handles empty/unknown/invalid input without invalid array indexing',()=>{
  const empty=createCatalogIndex([],[]);expect(empty.column(0)).toEqual([]);expect(empty.location(0)).toEqual({lane:0,row:12,slot:12})
  const index=createCatalogIndex([{category:'unknown'}],['known']);expect(index.location(0)).toEqual({lane:0,row:12,slot:12});expect(index.column(NaN)).toEqual([]);expect(index.column(Infinity)).toEqual([]);expect(index.column(.5)).toEqual([])
 })
 it('publishes new lookup tables atomically on rebuild without changing old readers',()=>{
  const old=createCatalogIndex([{category:'a'},{category:'b'}],['a','b']),next=createCatalogIndex([{category:'b'},{category:'a'},{category:'b'}],['b','a']);expect(old.column(1)).toEqual([1]);expect(next.column(0)).toEqual([0,2]);expect(next.location(2).row).toBe(13)
 })
})
