import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
interface GameDataLibrary {
 WorldReader:{create(path:string):Promise<{getLevelData():Promise<Record<string,unknown>>}>}
 readServerInfo(buffer:Uint8Array):Promise<{ip:string;name:string;icon:string;acceptTextures:number}[]>
 writeServerInfo(values:unknown[]):Promise<Uint8Array>
 parseGameOptions(value:string):Record<string,unknown>
 stringifyGameOptions(value:Record<string,unknown>):string
}
const require=createRequire(import.meta.url)
let library:GameDataLibrary|undefined
function get(){return library??=require(fileURLToPath(new URL('../../dist/node/game-data.cjs',import.meta.url)))}
export async function readOriginalWorld(path:string){const reader=await get().WorldReader.create(path);return reader.getLevelData()}
export async function readOriginalServers(value:Uint8Array){return get().readServerInfo(value)}
export async function writeOriginalServers(value:unknown[]){return get().writeServerInfo(value)}
export function parseOriginalOptions(value:string){return get().parseGameOptions(value)}
export function stringifyOriginalOptions(value:Record<string,unknown>){return get().stringifyGameOptions(value)}
