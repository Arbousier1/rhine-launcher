/**
 * Crash signature analysis.
 *
 * Minecraft fails in a handful of well known ways and the raw log rarely says
 * what the user should do. This module recognises the common signatures and
 * turns each into a Chinese message plus an actionable hint. It is pure: the
 * diagnostics service feeds it log text and decides where the text comes from.
 */
import type { LogLine } from '../types.ts'

/** One finding produced by {@link analyzeLog}. */
export interface CrashFinding {
  level: 'info' | 'warn' | 'error'
  message: string
  hint?: string
}

/** A recognisable log signature. */
export interface CrashSignature {
  /** Stable identifier, useful for tests and telemetry. */
  id: string
  level: CrashFinding['level']
  /** Substring or regular expression matched against the log text. */
  match: RegExp
  message: string
  hint?: string
}

/**
 * Known crash signatures.
 *
 * Order matters only for readability: every matching signature is reported, so
 * a log with an OOM and a missing dependency produces two findings.
 */
export const CRASH_SIGNATURES: CrashSignature[] = [
  {
    id: 'java-version-old',
    level: 'error',
    match: /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|class file version \d+/,
    message: 'Java 版本过低，游戏类文件无法被当前运行时加载。',
    hint: '在「Java 运行时」里选择一个与游戏版本匹配的 JDK（1.17 及以下用 8，1.18–1.20.4 用 17，1.20.5+ 用 21）。',
  },
  {
    id: 'java-version-new',
    level: 'error',
    match: /Unsupported class file major version|java\.lang\.IllegalArgumentException: Unsupported class file/i,
    message: 'Java 版本过高，部分模组或加载器尚不支持这个运行时。',
    hint: '把实例的 Java 运行时切换到版本要求更低的一档（例如 17 → 8，21 → 17）。',
  },
  {
    id: 'out-of-memory',
    level: 'error',
    match: /java\.lang\.OutOfMemoryError|GC overhead limit exceeded|There is insufficient memory for the Java Runtime Environment|Could not reserve enough space for object heap/i,
    message: '内存不足，游戏进程没能完成内存分配。',
    hint: '在实例设置里提高最大内存（-Xmx），并确认启动器/系统是 64 位；模组较多时建议 4096–8192 MB。',
  },
  {
    id: 'metaspace',
    level: 'warn',
    match: /Metaspace|MaxMetaspaceSize|PermGen space/i,
    message: '元空间不足，通常是大量模组同时加载造成的。',
    hint: '适当提高最大内存，或在 JVM 参数里加 -XX:MaxMetaspaceSize=1g。',
  },
  {
    id: 'missing-dependency',
    level: 'error',
    match: /Missing or unsupported mandatory dependencies|Mod resolution failed|requires any version of|Incompatible mod set!|net\.fabricmc\.loader\.impl\.FormattedException|Mod '.*' requires/i,
    message: '模组依赖缺失或不兼容，加载器在启动阶段拒绝了整合。',
    hint: '按日志里列出的模组名补齐前置模组，或停用版本不匹配的模组。',
  },
  {
    id: 'duplicate-mods',
    level: 'warn',
    match: /Duplicate mods found|Found duplicate mods|duplicate mod/i,
    message: '检测到重复安装的模组，加载器只会保留其中一个。',
    hint: '在「模组」页删除重复的 jar（通常是同一模组的新旧版本各留了一份）。',
  },
  {
    id: 'mixin-failure',
    level: 'error',
    match: /Mixin apply failed|org\.spongepowered\.asm\.mixin\.(?:MixinException|throwables)|MixinTransformerError/i,
    message: 'Mixin 注入失败，通常是模组之间冲突或加载器版本不匹配。',
    hint: '确认 Forge/Fabric 加载器版本与模组要求一致，并优先排查最近新增的模组。',
  },
  {
    id: 'opengl',
    level: 'error',
    match: /org\.lwjgl\.opengl\.GLException|Failed to create window|GLFW error|Pixel format not accelerated|The driver does not appear to support OpenGL|OpenGL \d\.\d+ (?:not supported|is required)|GL_INVALID_OPERATION/i,
    message: 'OpenGL 初始化失败，显卡驱动不支持游戏需要的图形接口。',
    hint: '更新显卡驱动，或使用支持 OpenGL 3.2+ 的独立显卡启动；远程桌面/虚拟机里通常无法运行。',
  },
  {
    id: 'jvm-crash',
    level: 'error',
    match: /A fatal error has been detected by the Java Runtime Environment|EXCEPTION_ACCESS_VIOLATION|SIGSEGV|hs_err_pid/i,
    message: 'Java 虚拟机崩溃（原生层错误），游戏没能正常退出。',
    hint: '在实例目录查看 hs_err_pid*.log；若与显卡驱动相关请更新驱动，否则尝试更换 Java 运行时或移除可疑模组。',
  },
  {
    id: 'corrupted-jar',
    level: 'error',
    match: /zip END header not found|Invalid or corrupt jarfile|java\.util\.zip\.ZipException/i,
    message: '版本或模组文件损坏，压缩包无法读取。',
    hint: '删除损坏的 jar 后重新安装该模组/版本。',
  },
  {
    id: 'main-class',
    level: 'error',
    match: /Could not find or load main class|ClassNotFoundException: net\.minecraft|NoClassDefFoundError: net\/minecraft/i,
    message: '找不到游戏主类，版本 jar 或 classpath 不完整。',
    hint: '重新安装该版本，或在「版本」页修复缺失的库文件。',
  },
  {
    id: 'auth',
    level: 'warn',
    match: /Invalid session|Authentication servers are down|Failed to verify username|401 Unauthorized/i,
    message: '账号验证失败，可能是登录状态过期。',
    hint: '在「账号」页刷新微软账号后重新启动。',
  },
  {
    id: 'mod-loader-missing',
    level: 'error',
    match: /java\.lang\.ClassNotFoundException: net\.fabricmc|java\.lang\.ClassNotFoundException: net\.minecraftforge|cpw\.mods\.modlauncher/i,
    message: '实例声明了加载器，但启动使用的版本没有对应加载器。',
    hint: '确认实例的加载器与所选版本一致；必要时重新安装 Fabric/Forge。',
  },
  {
    id: 'access-denied',
    level: 'warn',
    match: /AccessDeniedException|Permission denied|另一个程序正在使用此文件/i,
    message: '文件被占用或没有写入权限。',
    hint: '关闭同时运行的启动器/游戏窗口，或把数据目录移到有写权限的位置。',
  },
]

/** Additional hints derived from the exit code alone. */
export function exitCodeFindings(exitCode: number | null): CrashFinding[] {
  if (exitCode === null || exitCode === undefined) {
    return [{ level: 'warn', message: '游戏进程被终止，未返回退出码。', hint: '如果是启动器主动结束的可以忽略。' }]
  }
  if (exitCode === 0) return [{ level: 'info', message: '游戏已正常退出。' }]
  if (exitCode === 1) {
    return [{
      level: 'error',
      message: '游戏以退出码 1 结束，通常表示启动阶段就发生了异常。',
      hint: '查看下方日志里的第一条 ERROR 或 Exception 堆栈。',
    }]
  }
  if (exitCode === 137) {
    return [{
      level: 'warn',
      message: '进程被系统强制结束（退出码 137，通常是内存不足被 OOM Killer 终止）。',
      hint: '降低最大内存或关闭其他占用内存的程序。',
    }]
  }
  const findings: CrashFinding[] = [{ level: 'error', message: `游戏异常退出，退出码 ${exitCode}。` }]
  if (exitCode === -1073741819 || exitCode === 0xc0000005) {
    findings.push({
      level: 'error',
      message: '退出码对应内存访问违例（0xC0000005），是典型的显卡驱动或原生库崩溃。',
      hint: '更新显卡驱动，或关闭会注入游戏进程的覆盖层（如录屏、加速器）。',
    })
  }
  if (exitCode === -1073741571 || exitCode === 0xc00000fd) {
    findings.push({ level: 'error', message: '退出码对应栈溢出（0xC00000FD）。', hint: '在 JVM 参数里加 -Xss1m，或排查死循环的模组。' })
  }
  return findings
}

/** Run every signature against the log text. */
export function analyzeLog(text: string): CrashFinding[] {
  if (!text) return []
  const findings: CrashFinding[] = []
  const seen = new Set<string>()
  for (const signature of CRASH_SIGNATURES) {
    if (!signature.match.test(text)) continue
    if (seen.has(signature.id)) continue
    seen.add(signature.id)
    findings.push({ level: signature.level, message: signature.message, hint: signature.hint })
  }
  if (findings.length === 0) {
    findings.push({ level: 'info', message: '未在日志中发现已知的崩溃特征。' })
  }
  return findings
}

/** Analyse log lines (the shape the bus/WS layer already speaks). */
export function analyzeLines(lines: LogLine[]): CrashFinding[] {
  return analyzeLog(lines.map((line) => line.message).join('\n'))
}

/** Combine log analysis with exit-code hints and de-duplicate. */
export function analyzeCrash(logText: string | undefined, exitCode: number | null): CrashFinding[] {
  const findings = [...(exitCode === 0 ? [] : exitCodeFindings(exitCode)), ...analyzeLog(logText ?? '')]
  const out: CrashFinding[] = []
  const seen = new Set<string>()
  for (const finding of findings) {
    const key = finding.level + '|' + finding.message
    if (seen.has(key)) continue
    seen.add(key)
    out.push(finding)
  }
  return out
}

/** Keep only the last `count` lines of a log. */
export function tailLines(text: string, count: number): string {
  const lines = text.split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - count)).join('\n')
}

/** Patterns that make a log line count as an error for summaries. */
export const ERROR_LINE_PATTERN = /\b(ERROR|FATAL|SEVERE)\b|Exception|Caused by:/
