import type { Context } from '@deepseek-ai/cordis'
import type { TaskApi, TaskHandle } from '../contracts.ts'
import type { LogLine, Progress, TaskSnapshot, TaskStatus } from '../types.ts'

/** Thrown inside a task body when the user cancelled it. */
export class TaskCancelled extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'TaskCancelled'
  }
}

interface TaskRecord {
  snapshot: TaskSnapshot
  cancelled: boolean
  controller: AbortController
  done: Promise<TaskSnapshot>
  resolve: (snapshot: TaskSnapshot) => void
}

const MAX_LOGS = 500

/** Long running background work with progress, cancellation and event fan-out. */
export class TaskService implements TaskApi {
  private records = new Map<string, TaskRecord>()
  private seq = 0

  constructor(protected ctx: Context) {
  }

  run<T>(title: string, kind: string, body: (task: TaskHandle) => Promise<T>, signal?: AbortSignal): string {
    const id = `task-${++this.seq}-${Date.now().toString(36)}`
    let resolve!: (snapshot: TaskSnapshot) => void
    const done = new Promise<TaskSnapshot>((r) => { resolve = r })
    const record: TaskRecord = {
      snapshot: {
        id,
        kind,
        title,
        status: 'queued',
        progress: { value: 0, current: 0, total: 0, stage: 'resolve' },
        logs: [],
        createdAt: Date.now(),
      },
      cancelled: false,
      controller: new AbortController(),
      done,
      resolve,
    }
    this.records.set(id, record)

    const abort = () => { record.cancelled=true; record.controller.abort(new TaskCancelled()) }
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)abort()
    const handle = this.createHandle(record)
    this.patch(record, { status: 'running' })
    void (async () => {
      try {
        handle.throwIfCancelled()
        await new Promise<void>((resolve,reject)=>{
          const cancelled=()=>reject(new TaskCancelled())
          record.controller.signal.addEventListener('abort',cancelled,{once:true})
          Promise.resolve(body(handle)).then(()=>resolve(),reject)
            .finally(()=>record.controller.signal.removeEventListener('abort',cancelled)).catch(()=>{})
        })
        if (record.cancelled) throw new TaskCancelled()
        this.patch(record, { status: 'succeeded', finishedAt: Date.now() })
        record.snapshot.progress = { ...record.snapshot.progress, value: 1, stage: 'done' }
      } catch (error: any) {
        if (error instanceof TaskCancelled || record.cancelled) {
          this.patch(record, { status: 'cancelled', finishedAt: Date.now() })
        } else {
          const message = error instanceof Error ? error.message : String(error)
          this.pushLog(record, 'error', message)
          this.patch(record, { status: 'failed', error: message, finishedAt: Date.now() })
        }
      } finally {
        signal?.removeEventListener('abort',abort)
        this.publish(record)
        record.resolve(record.snapshot)
      }
    })()

    return id
  }

  list(): TaskSnapshot[] {
    return [...this.records.values()]
      .map((record) => record.snapshot)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): TaskSnapshot | undefined {
    return this.records.get(id)?.snapshot
  }

  cancel(id: string): boolean {
    const record = this.records.get(id)
    if (!record || record.snapshot.status !== 'running') return false
    record.cancelled = true
    record.controller.abort()
    this.pushLog(record, 'warn', '用户取消了任务')
    this.publish(record)
    return true
  }

  clear(): void {
    for (const [id, record] of this.records) {
      if (record.snapshot.status === 'running') continue
      this.records.delete(id)
    }
  }

  async wait(id: string): Promise<TaskSnapshot> {
    const record = this.records.get(id)
    if (!record) throw new Error(`任务不存在: ${id}`)
    return record.done
  }

  private createHandle(record: TaskRecord): TaskHandle {
    const service = this
    return {
      id: record.snapshot.id,
      signal: record.controller.signal,
      setProgress(progress: Partial<Progress>) {
        record.snapshot.progress = { ...record.snapshot.progress, ...progress }
        service.publish(record)
      },
      log(message: string, level: LogLine['level'] = 'info') {
        service.pushLog(record, level, message)
        service.publish(record)
      },
      get cancelled() {
        return record.cancelled || record.controller.signal.aborted
      },
      throwIfCancelled() {
        if (record.cancelled || record.controller.signal.aborted) throw new TaskCancelled()
      },
    }
  }

  private pushLog(record: TaskRecord, level: LogLine['level'], message: string): void {
    record.snapshot.logs.push({ time: Date.now(), level, message })
    if (record.snapshot.logs.length > MAX_LOGS) {
      record.snapshot.logs.splice(0, record.snapshot.logs.length - MAX_LOGS)
    }
  }

  private patch(record: TaskRecord, patch: Partial<TaskSnapshot> & { status?: TaskStatus }): void {
    Object.assign(record.snapshot, patch)
    this.publish(record)
  }

  private publish(record: TaskRecord): void {
    try { this.ctx.bus?.emit({ type: 'task', task: record.snapshot }) } catch { /* The owning feature may already be unloaded; task status remains queryable. */ }
  }
}

