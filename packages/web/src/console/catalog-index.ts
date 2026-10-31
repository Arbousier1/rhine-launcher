/** Immutable lookup tables built once per catalog revision, not once per pointer sample. */
export interface CatalogLocation{lane:number;row:number;slot:number}
const EMPTY:number[]=Object.freeze([]) as unknown as number[]
const FALLBACK:CatalogLocation=Object.freeze({lane:0,row:12,slot:12})
export function createCatalogIndex(records:readonly {category:string}[],categories:readonly string[]){
 const lanes=categories.map(()=>[] as number[]),byCategory=new Map(categories.map((name,lane)=>[name,lane])),locations:CatalogLocation[]=[]
 for(let index=0;index<records.length;index++){
  const lane=byCategory.get(records[index].category)
  if(lane===undefined){locations.push(FALLBACK);continue}
  const row=12+lanes[lane].length
  lanes[lane].push(index);locations.push(Object.freeze({lane,row,slot:lane*32+row}))
 }
 lanes.forEach(Object.freeze)
 const first=locations[0]??FALLBACK
 const fallback=Object.freeze({lane:first.lane,row:12,slot:first.lane*32+12})
 return {
  column(lane:number):number[]{if(!lanes.length||!Number.isInteger(lane))return EMPTY;return lanes[((lane%lanes.length)+lanes.length)%lanes.length]},
  location(index:number):CatalogLocation{return locations[index]??fallback},
 }
}
