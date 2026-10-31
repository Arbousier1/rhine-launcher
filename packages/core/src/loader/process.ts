/**
 * Child-process execution for loader installers and the OptiFine patcher.
 *
 * The loader never trusts a Java process result by exit code alone: callers
 * validate the produced archives afterwards. This module only owns streaming
 * logs, cancellation, timeouts and Chinese diagnostics.
 */
import { spawn } from 'node:child_process'

/** Default upper bound for an installer/patcher run. */
export const LOADER_PROCESS_TIMEOUT_MS = 10 * 60 * 1000

/** Number of trailing output lines kept for error messages. */
export const LOADER_OUTPUT_TAIL = 80

/** Failure of a Java child process. */
export class LoaderProcessError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null = null,
    readonly tail: string[] = [],
  ) {
    super(message)
    this.name = 'LoaderProcessError'
  }
}

/** Options for runJava. */
export interface RunJavaOptions {
  cwd?: string
  signal?: AbortSignal
  timeoutMs?: number
  /** Receives stdout/stderr lines as they arrive. */
  onLine?: (line: string, level: 'info' | 'warn') => void
  env?: NodeJS.ProcessEnv
}

/**
 * Run java and resolve when it exits with code 0.
 *
 * The process is killed on abort or timeout; both settle with a Chinese
 * LoaderProcessError so a cancelled feature unload cannot look like success.
 */
export function runJava(javaPath: string, args: string[], options: RunJavaOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new LoaderProcessError('安装已取消'))
      return
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(javaPath, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      reject(new LoaderProcessError('无法启动 Java 进程（' + javaPath + '）：' + messageOf(error)))
      return
    }

    const tail: string[] = []
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const push = (line: string, level: 'info' | 'warn'): void => {
      const text = line.trim()
      if (!text) return
      tail.push(text)
      if (tail.length > LOADER_OUTPUT_TAIL) tail.splice(0, tail.length - LOADER_OUTPUT_TAIL)
      try {
        options.onLine?.(text, level)
      } catch {
        // A broken log sink must not kill the installer.
      }
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const kill = (): void => {
      try {
        child.kill()
      } catch {
        // The process may already be gone.
      }
    }
    const onAbort = (): void => {
      kill()
      finish(new LoaderProcessError('安装已取消', null, [...tail]))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    forward(child.stdout, (line) => push(line, 'info'))
    forward(child.stderr, (line) => push(line, 'warn'))
    child.on('error', (error) => {
      finish(new LoaderProcessError('Java 进程启动失败：' + error.message, null, [...tail]))
    })
    child.on('close', (code) => {
      if (code === 0) {
        finish()
        return
      }
      finish(new LoaderProcessError(
        'Java 进程退出码 ' + code + '，操作失败' + (tail.length ? '：' + tail[tail.length - 1] : ''),
        code,
        [...tail],
      ))
    })
    const timeoutMs = options.timeoutMs ?? LOADER_PROCESS_TIMEOUT_MS
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        kill()
        finish(new LoaderProcessError(
          'Java 进程运行超时（超过 ' + Math.round(timeoutMs / 60000) + ' 分钟），已终止',
          null,
          [...tail],
        ))
      }, timeoutMs)
      timer.unref?.()
    }
  })
}

function forward(stream: NodeJS.ReadableStream | null, sink: (line: string) => void): void {
  if (!stream) return
  stream.setEncoding?.('utf8')
  let buffer = ''
  stream.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r\n|\r|\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) sink(line)
  })
  stream.on('end', () => {
    if (buffer) sink(buffer)
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
