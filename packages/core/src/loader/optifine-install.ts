/**
 * OptiFine installation with the real patcher.
 *
 * The installer jar is validated as a ZIP, its embedded launchwrapper jar is
 * extracted into libraries/, and optifine.Patcher is executed with
 * (base client jar, installer jar, output jar). The generated version json uses
 * launchwrapper's Launch main class and the OptiFine tweak class, inheriting
 * from the vanilla version. A failed run removes the outputs it created.
 */
import { createHash,randomUUID } from 'node:crypto'
import {withFileLock,writeFileAtomic} from '@deepseek-ai/dsh-atomic-write'
import {identifier} from '../plugins/http-input.ts'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LoaderHost } from './capabilities.ts'
import { reportProgress, throwIfAborted } from './capabilities.ts'
import {
  isZipArchive, listArchiveEntries, readArchiveEntry, readArchiveText,
} from './archive.ts'
import { downloadVerified, errorMessage, fetchChecksums, fetchText } from './http.ts'
import {
  buildOptiFineVersionJson, launchwrapperLibraryPath, optifineFilename, optifineInstallerUrls,
  optifineLibraryPath, optifineListUrls, optifineVersionId, parseOptiFineEntries,
  splitOptiFineVersion, type OptiFineBuild,
} from './optifine.ts'
import { LOADER_PROCESS_TIMEOUT_MS, runJava, type RunJavaOptions } from './process.ts'
import { loaderJavaMajor } from './runtime.ts'
import {
  readVersionJson, removeVersionDir, requireClientJar, versionJsonExists, versionJsonFile, writeVersionJson,
} from './versions.ts'
import type { LoaderProcessRunner } from './installer.ts'

/** Options for {@link installOptiFine}. */
export interface OptiFineInstallOptions {
  gameVersion: string
  loaderVersion: string
  /** Human label (progress/log messages). */
  label?: string
  /** Process runner override (tests). */
  runner?: LoaderProcessRunner
  timeoutMs?: number
}

/** Result files of an OptiFine install (also used in tests/reporting). */
export interface OptiFineInstallResult {
  id: string
  mainClass: string
  tweakClass: string
  launchwrapper: { version: string; path: string; sha1: string; size: number }
  patched: { path: string; sha1: string; size: number }
  installer: { path: string; sha1: string; size: number }
}

/**
 * Install OptiFine build (e.g. HD_U_I5_pre4) for a game version.
 *
 * @returns the installed version id; see {@link inspectOptiFineInstall} for the
 *   artifacts when a caller needs them.
 */
export async function installOptiFine(
  host: LoaderHost,
  options: OptiFineInstallOptions,
): Promise<string> {
  const result = await installOptiFineDetailed(host, options)
  return result.id
}

/** Install OptiFine and return every generated artifact for verification. */
export async function installOptiFineDetailed(host:LoaderHost,options:OptiFineInstallOptions):Promise<OptiFineInstallResult>{
 const temp=host.paths().temp;await mkdir(temp,{recursive:true})
 const key=join(temp,'optifine-'+identifier(options.gameVersion)+'-'+identifier(options.loaderVersion)+'.transaction')
 return withFileLock(key,()=>installOptiFineUnlocked(host,options),{signal:host.signal,waitMs:600000})
}

async function installOptiFineUnlocked(
  host: LoaderHost,
  options: OptiFineInstallOptions,
): Promise<OptiFineInstallResult> {
  const label = options.label ?? 'OptiFine'
  const paths = host.paths()
  const { gameVersion, loaderVersion } = options
  if (!splitOptiFineVersion(loaderVersion)) {
    throw new Error('OptiFine 版本格式不正确：' + loaderVersion)
  }

  reportProgress(host, { stage: 'resolve', value: 0.02, current: 0, total: 1, message: '获取 ' + label + ' 版本信息' })
  let build: OptiFineBuild | undefined
  try {
    const listed = await fetchText(host, optifineListUrls(gameVersion), label + ' 版本列表', { signal: host.signal })
    build = parseOptiFineEntries(JSON.parse(listed.text), gameVersion).find((entry) => entry.loaderVersion === loaderVersion)
  } catch (error) {
    host.log('无法获取 OptiFine 版本列表，使用名称推导：' + errorMessage(error), 'warn')
  }
  if (!build) {
    const split = splitOptiFineVersion(loaderVersion)!
    build = {
      loaderVersion,
      type: split.type,
      patch: split.patch,
      filename: optifineFilename(split.type, split.patch, gameVersion),
      preview: /^pre\d+/i.test(split.patch),
    }
  }

  if (!(await host.verifyVersion(gameVersion))) {
    host.log(gameVersion + ' 原版尚未安装，先安装原版', 'warn')
    reportProgress(host, { stage: 'resolve', value: 0.03, current: 0, total: 1, message: '安装原版 ' + gameVersion })
    await host.installVersion(gameVersion)
  }
  const baseJar = await requireClientJar(paths.versions, gameVersion)

  const java = await resolveJava(host, loaderJavaMajor('optifine', gameVersion), label)
  await mkdir(paths.temp, { recursive: true })
  const installerPath = join(paths.temp, 'optifine-' + gameVersion + '-' + loaderVersion + '-installer.jar')

  reportProgress(host, { stage: 'download', value: 0.08, current: 0, total: 1, message: '下载 ' + label + ' 安装包' })
  const installerUrls = optifineInstallerUrls(gameVersion, loaderVersion, build.filename)
  const checksums = await fetchChecksums(host, installerUrls, { signal: host.signal })
  if (!checksums.sha1 && !checksums.sha256) {
    host.log('OptiFine 镜像没有提供发布哈希，改为校验 ZIP 结构与内置 launchwrapper', 'warn')
  }
  const installer = await downloadVerified(host, {
    urls: installerUrls,
    destination: installerPath,
    label: label + ' 安装包',
    sha1: checksums.sha1,
    sha256: checksums.sha256,
    expectArchive: true,
    signal: host.signal,
  })
  const patcher = await readArchiveEntry(installerPath, 'optifine/Patcher.class')
  if (!patcher) throw new Error(label + ' 安装包缺少 optifine/Patcher.class，无法打补丁')

  reportProgress(host, { stage: 'extract', value: 0.2, current: 0, total: 1, message: '提取内置 launchwrapper' })
  const launchwrapper = await extractLaunchwrapper(host, installerPath, paths.libraries)

  reportProgress(host, { stage: 'extract', value: 0.35, current: 0, total: 1, message: '运行 OptiFine Patcher' })
  host.log('使用 Java ' + java.version + '（' + java.path + '）运行 optifine.Patcher')
  const outputPath = join(paths.libraries, ...optifineLibraryPath(gameVersion, loaderVersion).split('/'))
  const previousOutput = await readFile(outputPath).catch(error=>{if(error.code==='ENOENT')return undefined;throw error})
  const outputExisted = previousOutput !== undefined
  const tempOutput = outputPath + '.' + randomUUID() + '.part'
  await mkdir(dirname(outputPath), { recursive: true })
  await rm(tempOutput, { force: true }).catch(() => undefined)
  const runner = options.runner ?? runJava
  try {
    await runner(java.path, ['-cp', installerPath, 'optifine.Patcher', baseJar, installerPath, tempOutput], {
      cwd: paths.root,
      signal: host.signal,
      timeoutMs: options.timeoutMs ?? LOADER_PROCESS_TIMEOUT_MS,
      onLine: (line, level) => host.log(line, level),
    })
    throwIfAborted(host)
    if (!(await isZipArchive(tempOutput))) {
      throw new Error('optifine.Patcher 没有生成有效的 patched jar')
    }
    const patchedInfo = await fileInfo(tempOutput)
    if (patchedInfo.size === 0) throw new Error('optifine.Patcher 生成的 jar 为空')
    await rename(tempOutput, outputPath)
  } catch (error) {
    await rm(tempOutput, { force: true }).catch(() => undefined)
    if (!outputExisted) await rm(outputPath, { force: true }).catch(() => undefined)
    // Verified shared launchwrapper is immutable cache, not a private temporary.
    throw new Error('OptiFine 打补丁失败：' + errorMessage(error))
  }
  const patched = await fileInfo(outputPath)

  reportProgress(host, { stage: 'write', value: 0.85, current: 0, total: 1, message: '写入 OptiFine 版本文件' })
  const baseVersion = await readVersionJson(paths.versions, gameVersion)
  const legacyArguments = typeof baseVersion?.minecraftArguments === 'string'
    ? baseVersion.minecraftArguments
    : undefined
  const json = buildOptiFineVersionJson({
    gameVersion,
    loaderVersion,
    optifine: {
      path: optifineLibraryPath(gameVersion, loaderVersion),
      sha1: patched.sha1,
      size: patched.size,
    },
    launchwrapper: {
      version: launchwrapper.version,
      path: launchwrapperLibraryPath(launchwrapper.version),
      sha1: launchwrapper.sha1,
      size: launchwrapper.size,
    },
    legacyArguments,
  })
  const id = typeof json.id === 'string' ? json.id : optifineVersionId(gameVersion, loaderVersion)
  const existed = await versionJsonExists(paths.versions, id)
  let previousVersion:Buffer|undefined
  try {
    if(existed)previousVersion=await readFile(versionJsonFile(paths.versions,id))
    throwIfAborted(host)
    await writeVersionJson(paths.versions, json, host.signal)
    const installed = await host.installedVersions()
    if (!installed.includes(id)) throw new Error('写入后未在已安装版本列表中找到 ' + id)
  } catch (error) {
    if(previousVersion)await writeFileAtomic(versionJsonFile(paths.versions,id),previousVersion,{mode:0o600})
    else if (!existed) await removeVersionDir(paths.versions, id)
    if(previousOutput)await writeFileAtomic(outputPath,previousOutput,{mode:0o644})
    else await rm(outputPath,{force:true})
    throw new Error(label + ' 安装失败：' + errorMessage(error))
  }
  if (!launchwrapper.existed) {
    host.log('已提取内置 launchwrapper ' + launchwrapper.version, 'debug')
  }
  reportProgress(host, { stage: 'done', value: 1, current: 1, total: 1, message: label + ' 安装完成' })
  host.log('已安装 ' + label + ' ' + loaderVersion + '（' + id + '，mainClass ' + json.mainClass + '）')
  return {
    id,
    mainClass: String(json.mainClass),
    tweakClass: 'optifine.OptiFineTweaker',
    installer: { path: installerPath, sha1: installer.sha1, size: installer.bytes },
    launchwrapper: {
      version: launchwrapper.version,
      path: join(paths.libraries, ...launchwrapperLibraryPath(launchwrapper.version).split('/')),
      sha1: launchwrapper.sha1,
      size: launchwrapper.size,
    },
    patched: { path: outputPath, sha1: patched.sha1, size: patched.size },
  }
}

interface LaunchwrapperExtraction {
  version: string
  sha1: string
  size: number
  existed: boolean
}

async function extractLaunchwrapper(
  host: LoaderHost,
  installerPath: string,
  librariesRoot: string,
): Promise<LaunchwrapperExtraction> {
  const entries = await listArchiveEntries(installerPath)
  const entry = entries
    .filter((name) => /^launchwrapper(?:-of)?-[^/]+\.jar$/i.test(name))
    .sort((left, right) => (/launchwrapper-of-/.test(left) ? -1 : 0) - (/launchwrapper-of-/.test(right) ? -1 : 0))[0]
  if (!entry) throw new Error('OptiFine 安装包内没有内置 launchwrapper jar')
  const data = await readArchiveEntry(installerPath, entry)
  if (!data || data.length === 0) throw new Error('无法读取 OptiFine 内置 launchwrapper')
  const declared = (await readArchiveText(installerPath, 'launchwrapper-of.txt'))?.trim()
  const fromName = /^launchwrapper(?:-of)?-(.+)\.jar$/i.exec(entry)?.[1]
  const version = sanitizeVersion(declared || fromName || '')
  if (!version) throw new Error('无法确定 OptiFine 内置 launchwrapper 版本')
  const destination = join(librariesRoot, ...launchwrapperLibraryPath(version).split('/'))
  const existed = await isFile(destination)
  await mkdir(dirname(destination), { recursive: true })
  if(existed){const existing=await fileInfo(destination);if(existing.sha1===createHash('sha1').update(data).digest('hex'))return {version,sha1:existing.sha1,size:existing.size,existed:true};throw new Error('已存在的共享 launchwrapper 与发布文件不一致')}
  const temp = destination + '.' + randomUUID() + '.part'
  await writeFile(temp, data)
  if (!(await isZipArchive(temp))) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw new Error('OptiFine 内置 launchwrapper 不是有效的 jar')
  }
  await rename(temp, destination)
  const info = await fileInfo(destination)
  host.log('已提取 launchwrapper-of-' + version + '（' + info.size + ' 字节，sha1 ' + info.sha1 + '）', 'debug')
  return { version, sha1: info.sha1, size: info.size, existed }
}

async function resolveJava(host: LoaderHost, major: number, label: string): Promise<{ path: string; version: string }> {
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

async function fileInfo(path: string): Promise<{ sha1: string; size: number }> {
  const data = await readFile(path)
  return { sha1: createHash('sha1').update(data).digest('hex'), size: (await stat(path)).size }
}

async function maybeRemoveLaunchwrapper(
  extraction: LaunchwrapperExtraction,
  host: LoaderHost,
): Promise<void> {
  if (extraction.existed) return
  const paths = host.paths()
  await rm(join(paths.libraries, ...launchwrapperLibraryPath(extraction.version).split('/')), { force: true }).catch(() => undefined)
}

function sanitizeVersion(value: string): string | undefined {
  const text = value.trim()
  if (!/^[0-9][0-9A-Za-z._+-]*$/.test(text)) return undefined
  return text
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}