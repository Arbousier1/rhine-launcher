/**
 * Forge/NeoForge installer execution.
 *
 * The installer jar embeds install_profile.json and the final version.json.
 * Before executing it the loader prefetches every library and processor
 * classpath entry named by that profile (HTTPS mirrors + publisher hashes +
 * ZIP validation), so the installer's own download stage has nothing to fetch.
 * A failed run restores the previous version json (or removes the new directory)
 * and never leaves a half-installed version behind.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { LoaderHost } from './capabilities.ts'
import { reportProgress, throwIfAborted } from './capabilities.ts'
import { LoaderArchiveError, readArchiveJson } from './archive.ts'
import type { LoadedVersionJson } from './types.ts'
import {
  downloadVerified, errorMessage, fetchChecksums,
} from './http.ts'
import {
  clientProcessors, collectInstallerArtifacts, installerGameVersion, installerVersionId,
  type InstallerArtifact, type InstallerProfile, type InstallerVersionJson,
} from './maven.ts'
import {
  LOADER_PROCESS_TIMEOUT_MS, runJava, type RunJavaOptions,
} from './process.ts'
import {
  ensureLauncherProfiles, readVersionJson, removeVersionDir, versionJsonFile,
} from './versions.ts'

/** Executes a Java child process (injectable for tests). */
export type LoaderProcessRunner = (
  javaPath: string,
  args: string[],
  options: RunJavaOptions,
) => Promise<void>

/** Options for {@link installWithInstaller}. */
export interface InstallerInstallOptions {
  kind: 'forge' | 'neoforge'
  gameVersion: string
  loaderVersion: string
  /** Human label used in progress/errors. */
  label: string
  /** Candidate HTTPS installer URLs (official first, mirror second). */
  installerUrls: string[]
  /** Canonical version id the installer should generate. */
  expectedVersionId: string
  /** Java feature version needed by the installer/processors. */
  javaMajor: number
  /** Publisher hash when a trusted metadata source provides one. */
  expectedSha256?: string
  /** Process runner override (tests). */
  runner?: LoaderProcessRunner
  /** Installer timeout (defaults to ten minutes). */
  timeoutMs?: number
}

/** Result of prefetching installer dependencies. */
export interface PrefetchResult {
  artifacts: number
  verified: number
  unverified: number
}

/**
 * Validate that an installer jar targets the requested game/version.
 *
 * @throws Error with a Chinese message when the embedded profile belongs to a
 *   different Minecraft version or has no usable version metadata.
 */
export function validateInstallerPackage(
  profile: InstallerProfile | undefined,
  version: InstallerVersionJson | undefined,
  options: Pick<InstallerInstallOptions, 'gameVersion' | 'expectedVersionId' | 'label'>,
): string {
  const game = installerGameVersion(profile, version)
  if (!game) throw new Error(options.label + ' 安装包缺少 Minecraft 版本信息')
  if (game !== options.gameVersion) {
    throw new Error(options.label + ' 安装包目标版本为 ' + game + '，与请求的 ' + options.gameVersion + ' 不一致')
  }
  const versionId = installerVersionId(profile, version)
  if (!versionId) throw new Error(options.label + ' 安装包缺少版本 id')
  if (versionId !== options.expectedVersionId) {
    throw new Error(options.label + ' 安装包版本 id 为 ' + versionId + '，与预期的 ' + options.expectedVersionId + ' 不一致')
  }
  if (!Array.isArray(version?.libraries) || version.libraries.length === 0) {
    throw new Error(options.label + ' 安装包没有可用的 libraries 列表')
  }
  if (typeof version?.mainClass !== 'string' || !version.mainClass) {
    throw new Error(options.label + ' 安装包没有 mainClass')
  }
  if (!Array.isArray(profile?.processors)) {
    throw new Error(options.label + ' 安装包缺少 processors 列表')
  }
  return versionId
}

/**
 * Prefetch every library and processor dependency of an installer profile.
 *
 * Files with publisher sha1 metadata are verified against it; processor-only
 * dependencies additionally fetch '.sha1'/'.sha256' sidecars when the mirror
 * provides them. Every jar/zip must parse as a ZIP archive before the installer
 * is allowed to run.
 */
export async function prefetchInstallerArtifacts(
  host: LoaderHost,
  artifacts: InstallerArtifact[],
): Promise<PrefetchResult> {
  const total = artifacts.length
  let completed = 0
  let verified = 0
  let unverified = 0
  reportProgress(host, {
    stage: 'download',
    value: 0.1,
    current: 0,
    total,
    message: '预取安装器依赖（' + total + ' 个文件）',
  })

  const controller=new AbortController()
  const groupSignal=host.signal?AbortSignal.any([host.signal,controller.signal]):controller.signal
  let firstError:unknown
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++
      if (index >= artifacts.length) return
      throwIfAborted(host)
      groupSignal.throwIfAborted()
      const artifact = artifacts[index]
      const checksums = artifact.sha1
        ? { sha1: artifact.sha1 }
        : await fetchChecksums(host, artifact.urls, { signal: groupSignal })
      const expectArchive = /\.(?:jar|zip)$/i.test(artifact.path)
      await downloadVerified(host, {
        urls: artifact.urls,
        destination: artifact.destination,
        label: '安装器依赖 ' + artifact.label,
        sha1: artifact.sha1 ?? checksums.sha1,
        sha256: checksums.sha256,
        size: artifact.size,
        expectArchive,
        signal: groupSignal,
      })
      if (artifact.sha1 ?? checksums.sha1 ?? checksums.sha256) verified++
      else unverified++
      completed++
      reportProgress(host, {
        stage: 'download',
        value: total === 0 ? 0.7 : 0.1 + 0.6 * (completed / total),
        current: completed,
        total,
        message: '预取安装器依赖（' + completed + '/' + total + '）',
      })
    }
  }
  await Promise.allSettled(Array.from({length:Math.min(4,Math.max(1,total))},async()=>{try{await worker()}catch(error){firstError??=error;controller.abort(error)}}))
  if(firstError)throw firstError
  return { artifacts: total, verified, unverified }
}

/**
 * Run a Forge/NeoForge client installer and return the generated version id.
 */
export async function installWithInstaller(
  host: LoaderHost,
  options: InstallerInstallOptions,
): Promise<string> {
  const paths = host.paths()
  const label = options.label
  reportProgress(host, { stage: 'resolve', value: 0.02, current: 0, total: 1, message: '准备安装 ' + label })

  if (!(await host.verifyVersion(options.gameVersion))) {
    host.log(options.gameVersion + ' 原版尚未安装，先安装原版', 'warn')
    reportProgress(host, { stage: 'resolve', value: 0.03, current: 0, total: 1, message: '安装原版 ' + options.gameVersion })
    await host.installVersion(options.gameVersion)
  }

  const java = await resolveInstallerJava(host, options.javaMajor, label)
  await ensureLauncherProfiles(paths.root)
  await mkdir(paths.temp, { recursive: true })
  const installerPath = join(
    paths.temp,
    options.kind + '-' + options.gameVersion + '-' + options.loaderVersion + '-installer.jar',
  )

  reportProgress(host, { stage: 'download', value: 0.05, current: 0, total: 1, message: '下载 ' + label + ' 安装器' })
  const installerChecksums = await fetchChecksums(host, options.installerUrls, { signal: host.signal })
  const installerSha1 = installerChecksums.sha1
  const installerSha256 = installerChecksums.sha256 ?? options.expectedSha256
  if (!installerSha1 && !installerSha256) {
    host.log('未找到 ' + label + ' 安装器的发布哈希，改为校验 ZIP 结构与安装元数据', 'warn')
  }
  try {
    await downloadVerified(host, {
      urls: options.installerUrls,
      destination: installerPath,
      label: label + ' 安装器',
      sha1: installerSha1,
      sha256: installerSha256,
      expectArchive: true,
      signal: host.signal,
    })
  } catch (error) {
    throw new Error('下载 ' + label + ' 安装器失败：' + errorMessage(error))
  }

  let profile: InstallerProfile | undefined
  let version: InstallerVersionJson | undefined
  try {
    profile = await readArchiveJson<InstallerProfile>(installerPath, 'install_profile.json')
    version = await readArchiveJson<InstallerVersionJson>(installerPath, 'version.json')
  } catch (error) {
    if (error instanceof LoaderArchiveError) throw new Error(label + ' 安装器不是有效的安装包：' + error.message)
    throw error
  }
  const versionId = validateInstallerPackage(profile, version, options)
  host.log(label + ' 安装包校验通过：' + versionId + '，处理器 ' + clientProcessors(profile).length + ' 个')

  reportProgress(host, { stage: 'download', value: 0.1, current: 0, total: 1, message: '预取 ' + label + ' 依赖' })
  const artifacts = collectInstallerArtifacts(profile, version, paths.libraries)
  const prefetched = await prefetchInstallerArtifacts(host, artifacts)
  if (prefetched.unverified > 0) {
    host.log(prefetched.unverified + ' 个安装器依赖没有发布哈希，仅校验 ZIP 完整性', 'warn')
  }

  const versionJsonPath = versionJsonFile(paths.versions, versionId)
  const previous = await readFile(versionJsonPath).catch(() => undefined)
  const versionDir = join(paths.versions, versionId)
  const dirExisted = await pathExists(versionDir)
  try {
    reportProgress(host, { stage: 'extract', value: 0.75, current: 0, total: 1, message: '运行 ' + label + ' 安装器' })
    host.log('使用 Java ' + java.version + '（' + java.path + '）运行 ' + label + ' 安装器')
    const runner = options.runner ?? runJava
    await runner(java.path, ['-jar', installerPath, '--installClient', paths.root], {
      cwd: paths.root,
      signal: host.signal,
      timeoutMs: options.timeoutMs ?? LOADER_PROCESS_TIMEOUT_MS,
      onLine: (line, level) => host.log(line, level),
    })

    reportProgress(host, { stage: 'verify', value: 0.92, current: 0, total: 1, message: '校验 ' + label + ' 安装结果' })
    const generated = await readVersionJson(paths.versions, versionId)
    if (!generated) {
      throw new Error(label + ' 安装器已结束，但没有生成版本文件：' + versionId)
    }
    validateGeneratedVersion(generated, versionId, options.gameVersion, label)
    return versionId
  } catch (error) {
    await restoreVersion(versionJsonPath, versionDir, previous, dirExisted)
    throw error
  }
}

/** Validate the version json written by the installer. */
export function validateGeneratedVersion(
  generated: LoadedVersionJson,
  versionId: string,
  gameVersion: string,
  label: string,
): void {
  if (generated.id !== versionId) {
    throw new Error(label + ' 生成的版本 id 为 ' + String(generated.id) + '，预期 ' + versionId)
  }
  if (generated.inheritsFrom !== gameVersion) {
    throw new Error(label + ' 生成的版本 inheritsFrom 为 ' + String(generated.inheritsFrom) + '，预期 ' + gameVersion)
  }
  if (typeof generated.mainClass !== 'string' || !generated.mainClass) {
    throw new Error(label + ' 生成的版本缺少 mainClass')
  }
  if (!Array.isArray(generated.libraries) || generated.libraries.length === 0) {
    throw new Error(label + ' 生成的版本缺少 libraries')
  }
}

async function restoreVersion(
  versionJsonPath: string,
  versionDir: string,
  previous: Buffer | undefined,
  dirExisted: boolean,
): Promise<void> {
  try {
    if (previous) {
      await mkdir(dirname(versionJsonPath), { recursive: true })
      await writeFile(versionJsonPath, previous)
      return
    }
    if (!dirExisted) {
      await removeVersionDir(dirname(versionDir), basename(versionDir))
      return
    }
    await rm(versionJsonPath, { force: true })
  } catch {
    // Rollback must never mask the original installer error.
  }
}

async function resolveInstallerJava(
  host: LoaderHost,
  major: number,
  label: string,
): Promise<{ path: string; version: string }> {
  let runtime = host.pickJava(major)
  if (!runtime) {
    await host.scanJava()
    runtime = host.pickJava(major)
  }
  if (!runtime) {
    throw new Error('安装 ' + label + ' 需要 Java ' + major + '，但本机没有可用的 Java 运行时，请先在「Java 运行时」页面安装')
  }
  return runtime
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
