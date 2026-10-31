const secretKeys=new Set(['accessToken','refreshToken','clientToken','password','deviceCode','curseforgeApiKey'])
/** Public transport data never contains credential values, regardless of event shape. */
export function publicValue(value:unknown):unknown{
 if(Array.isArray(value))return value.map(publicValue)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!secretKeys.has(key)).map(([key,item])=>[key,publicValue(item)]))
 return value
}
