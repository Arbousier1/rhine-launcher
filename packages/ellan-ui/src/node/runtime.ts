import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
export interface OriginalVersionHeader { id: string; minecraft: string; forge: string; fabric: string; quilt: string; neoForged: string; optifine: string; [key: string]: unknown }
interface Parser {
  Version: { parse(directory: string, id: string): Promise<Record<string, unknown>> }
  getResolvedVersionHeader(version: Record<string, unknown>): OriginalVersionHeader
  findMatchedVersion(headers: OriginalVersionHeader[], id: string, runtime: Record<string, unknown>): OriginalVersionHeader | undefined
}
const require = createRequire(import.meta.url)
let parser: Parser | undefined
function load(): Parser {
  return parser ??= require(fileURLToPath(new URL('../../dist/node/original-defaults.cjs', import.meta.url)))
}
export async function parseOriginalVersion(directory: string, id: string) { return load().Version.parse(directory, id) }
export function originalVersionHeader(version: Record<string, unknown>) { return load().getResolvedVersionHeader(version) }
export function matchOriginalVersion(headers: OriginalVersionHeader[], runtime: Record<string, unknown>, id?: string) { return load().findMatchedVersion(headers, id ?? '', runtime) }
