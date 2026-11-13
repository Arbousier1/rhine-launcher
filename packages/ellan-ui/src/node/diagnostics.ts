import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import type { OriginalVersionHeader } from './runtime.ts'

export interface OriginalInstallIssue {
  jar?: string
  forge?: { minecraft: string; version: string }
  libraries?: Record<string, unknown>[]
  assets?: { name: string; hash: string; size: number }[]
  assetsIndex?: Record<string, unknown>
  profile?: Record<string, unknown>
  optifine?: string
}
export interface OriginalServerVersion {
  id: string; minecraftVersion: string; mainClass: string; jar?: string
  libraries: { isNative: boolean; download: { path: string } }[]
  arguments: { jvm: string[]; game: string[] }
}
export interface OriginalServerPlan {
  file: { path: string; urls: string[]; size?: number; checksum: { algorithm: string; value: string } }
  operations: { type: string; path: string; content?: string }[]
}
interface MaintainedRuntime {
  diagnoseOriginalInstallation(directory: string, id: string, side: 'client' | 'server'): Promise<OriginalInstallIssue | undefined>
  parseOriginalServerVersion(directory: string, id: string): Promise<OriginalServerVersion>
  generateOriginalClientArguments(options: Record<string, unknown>): Promise<string[]>
  generateOriginalServerArguments(options: Record<string, unknown>): string[]
  watchOriginalMinecraftProcess(child: ChildProcess): EventEmitter
  matchOriginalInstalledVersion(headers: OriginalVersionHeader[], id: string, runtime: Record<string, unknown>): OriginalVersionHeader | undefined
  planOriginalVanillaServer(directory: string, id: string): Promise<OriginalServerPlan>
}
const require = createRequire(import.meta.url)
let runtime: MaintainedRuntime | undefined
function load(): MaintainedRuntime {
  return runtime ??= require(fileURLToPath(new URL('../../dist/node/original-diagnostics.cjs', import.meta.url)))
}
export function diagnoseOriginalInstallation(directory: string, id: string, side: 'client' | 'server') {
  return load().diagnoseOriginalInstallation(directory, id, side)
}
export function parseOriginalServerVersion(directory: string, id: string) { return load().parseOriginalServerVersion(directory, id) }
export function generateOriginalClientArguments(options: Record<string, unknown>) { return load().generateOriginalClientArguments(options) }
export function generateOriginalServerArguments(options: Record<string, unknown>) { return load().generateOriginalServerArguments(options) }
export function watchOriginalMinecraftProcess(child: ChildProcess) { return load().watchOriginalMinecraftProcess(child) }
/** The actual original signature is (headers, selected id, runtime). */
export function matchOriginalInstalledVersion(headers: OriginalVersionHeader[], id: string, requirements: Record<string, unknown>) {
  return load().matchOriginalInstalledVersion(headers, id, requirements)
}
export function planOriginalVanillaServer(directory: string, id: string) { return load().planOriginalVanillaServer(directory, id) }
