import zh from './locale/zh.json'
/**
 * Locale catalogue, matching DSH's locale/*.json convention. A missing key
 * fails loudly in development instead of rendering a raw key to players.
 */
const catalogue=zh as Record<string,unknown>
export function hasMessage(key:string):boolean{return lookup(key)!==undefined}
function lookup(key:string):string|undefined{
 let node:unknown=catalogue
 for(const part of key.split('.')){if(!node||typeof node!=='object')return undefined;node=(node as Record<string,unknown>)[part]}
 return typeof node==='string'?node:undefined
}
export function t(key:string,...args:(string|number)[]):string{
 const template=lookup(key)
 if(template===undefined){if(import.meta.env.DEV)console.warn('[i18n] missing key:',key);return key}
 let index=0
 return args.length?template.replace(/%s/g,()=>String(args[index++])):template
}
