import {settlingWave,columnStrength} from './motion'
/** Cache separable values only inside this one simulation frame. */
export function frameFactors(shoulder:number,laneFocus:number){
 const shoulders=new Map<number,number>(),strengths=new Map<number,number>()
 return {
  shoulder(row:number){let value=shoulders.get(row);if(value===undefined){value=settlingWave(row-shoulder,26.56);shoulders.set(row,value)}return value},
  strength(lane:number){let value=strengths.get(lane);if(value===undefined){value=columnStrength(lane,laneFocus);strengths.set(lane,value)}return value},
 }
}
