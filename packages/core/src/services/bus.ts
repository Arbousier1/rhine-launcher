import type { Context } from '@deepseek-ai/cordis'
import type { BusApi } from '../contracts.ts'
import type { ServerEvent } from '../types.ts'

/**
 * In-process event fan-out between core services and the transport layer.
 *
 * Core services never know about sockets: they `ctx.bus.emit()`, and the
 * server subscribes once per WebSocket connection.
 */
export class BusService implements BusApi {
  private listeners = new Set<(event: ServerEvent) => void>()

  constructor(protected ctx: Context) {
  }

  emit(event: ServerEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        this.ctx.logger('bus').warn('事件监听器抛错: %o', error)
      }
    }
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Number of active subscribers (diagnostics). */
  get size(): number {
    return this.listeners.size
  }
}

