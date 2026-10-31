/**
 * Loader feature host boundary.
 *
 * Loader actions never import another feature implementation. They receive a
 * FeatureEnvironment from the runtime and talk to the declared base
 * capabilities through env.use, so disabling a base feature blocks the loader
 * actions that require it instead of leaving a half-working service behind.
 */
import type { FeatureEnvironment, TaskContext } from '@rhine/plugin-api'
import type { DownloadOptions, RhPaths } from '../contracts.ts'
import type { JavaRuntime } from '../types.ts'

/** Base capability ids the loader actions may declare as dependencies. */
export const LOADER_CAPABILITY = {
  pathsGet: 'paths.get',
  downloadText: 'download.text',
  downloadFile: 'download.file',
  versionVerify: 'version.verify',
  versionInstalled: 'version.installed',
  versionInstall: 'version.install',
  javaPick: 'java.pick',
  javaScan: 'java.scan',
} as const

/** Input accepted by java.pick. */
export interface JavaPickInput {
  majorVersion: number
  preferred?: string
}

/** The narrow host surface every loader implementation is written against. */
export interface LoaderHost {
  readonly signal: AbortSignal
  readonly task: TaskContext | undefined
  /** Absolute launcher directories. */
  paths(): RhPaths
  /** Fetch a small text resource (metadata, sha1 sidecars). */
  text(url: string): Promise<string>
  /** Download one file; the base downloader verifies sha1/size when provided. */
  file(options: DownloadOptions): Promise<number>
  /** True when a version id is fully installed. */
  verifyVersion(id: string): Promise<boolean>
  /** Installed version ids. */
  installedVersions(): Promise<string[]>
  /** Install a vanilla version when it is missing. */
  installVersion(gameVersion: string): Promise<void>
  /** Synchronous JRE selection from the cached scan. */
  pickJava(majorVersion: number, preferred?: string): JavaRuntime | undefined
  /** Rescan the filesystem for JREs. */
  scanJava(): Promise<JavaRuntime[]>
  /** Progress/log sink (env.task when the host started a background task). */
  log(message: string, level?: 'debug' | 'info' | 'warn' | 'error'): void
}

/**
 * Build a host for one execute() call.
 *
 * A fresh host is created per call on purpose: caching the environment (and its
 * AbortSignal) would pin the first caller's lifecycle and leak state between
 * enable/disable cycles.
 */
export function createLoaderHost(env: FeatureEnvironment): LoaderHost {
  const task = env.task
  return {
    signal: env.signal,
    task,
    paths: () => env.use<RhPaths>(LOADER_CAPABILITY.pathsGet),
    text: (url) => env.use<Promise<string>>(LOADER_CAPABILITY.downloadText, url),
    file: (options) => env.use<Promise<number>>(LOADER_CAPABILITY.downloadFile, options),
    verifyVersion: (id) => env.use<Promise<boolean>>(LOADER_CAPABILITY.versionVerify, { id }),
    installedVersions: () => env.use<Promise<string[]>>(LOADER_CAPABILITY.versionInstalled),
    installVersion: (gameVersion) =>
      env.use<Promise<void>>(LOADER_CAPABILITY.versionInstall, { gameVersion }),
    pickJava: (majorVersion, preferred) =>
      env.use<JavaRuntime | undefined>(LOADER_CAPABILITY.javaPick, { majorVersion, preferred }),
    scanJava: () => env.use<Promise<JavaRuntime[]>>(LOADER_CAPABILITY.javaScan),
    log: (message, level = 'info') => {
      task?.log(message, level)
    },
  }
}

/** Progress helper shared by install actions. */
export function reportProgress(
  host: LoaderHost,
  progress: { value?: number; stage?: 'resolve' | 'download' | 'verify' | 'extract' | 'write' | 'done'; current?: number; total?: number; message?: string },
): void {
  host.task?.setProgress(progress)
}

/** Throw the runtime's cancellation error when the feature was unloaded. */
export function throwIfAborted(host: LoaderHost): void {
  if (host.signal.aborted) {
    const error = new Error('安装已取消')
    error.name = 'AbortError'
    throw error
  }
}
