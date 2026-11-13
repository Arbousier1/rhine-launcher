import { TransportFrameDecoder } from '../vendor/deskgap/framing.ts'

export interface OriginalInvoke {
  type: 'invoke'
  id: number
  channel: string
  args: unknown[]
}
export interface NativeDropEntry { handle: string; kind: 'file' | 'directory'; name: string; size: number | null }
export interface VirtualTransportOptions {
  /** Resolve a declared original operation through the compatibility feature registry. */
  invoke(message: OriginalInvoke, rendererId: string, signal: AbortSignal): Promise<unknown>
  /** Original event arrays, translated from real backend events. */
  subscribe(listener: (event: readonly unknown[]) => void): () => void
  onFilesDropped?(listener: (event: { entries: readonly NativeDropEntry[] }) => void): () => void
}
interface Channel {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<ArrayBuffer | ArrayBufferView>
}
interface Receiver { push(value: unknown): void; close(): void }

/** Supplies the original DeskGap bridge's declared API; the bridge owns SharedState hydration. */
export function createVirtualDeskGap(options: VirtualTransportOptions) {
  const scope = new AbortController()
  const receivers = new Set<Receiver>()
  const unsubscribe = options.subscribe(event => { for (const receiver of receivers) receiver.push(event) })
  let disposed = false
  return {
    createChannel(): Channel {
      if (disposed) throw new Error('Original renderer transport has been disposed')
      let controller: ReadableStreamDefaultController<Uint8Array>
      let rendererId: string | undefined
      let closed = false
      const decoder = new TransportFrameDecoder()
      const receiver: Receiver = {
        push(value) {
          if (closed) return
          const payload = new TextEncoder().encode(JSON.stringify(value))
          const frame = new Uint8Array(4 + payload.byteLength)
          new DataView(frame.buffer).setUint32(0, payload.byteLength)
          frame.set(payload, 4)
          controller.enqueue(frame)
        },
        close() {
          if (closed) return
          closed = true
          receivers.delete(receiver)
          controller.close()
        },
      }
      const readable = new ReadableStream<Uint8Array>({
        start(value) { controller = value },
        cancel() { closed = true; receivers.delete(receiver) },
      })
      receivers.add(receiver)
      const writable = new WritableStream<ArrayBuffer | ArrayBufferView>({
        async write(value) {
          if (closed || disposed) throw new Error('Original renderer transport is closed')
          const bytes = ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value)
          for (const frame of decoder.push(bytes)) {
            const value: unknown = JSON.parse(new TextDecoder().decode(frame))
            if (!value || typeof value !== 'object') throw new Error('Invalid original transport message')
            const message = value as Record<string, unknown>
            if (message.type === 'connect' && typeof message.rendererId === 'string') {
              rendererId = message.rendererId
              continue
            }
            if (!rendererId || message.type !== 'invoke' || !Number.isSafeInteger(message.id)
              || typeof message.channel !== 'string' || !Array.isArray(message.args)) {
              throw new Error('Invalid original operation message')
            }
            const invoke: OriginalInvoke = { type: 'invoke', id: Number(message.id), channel: message.channel, args: message.args }
            const owner = rendererId
            // A write acknowledges receipt, not completion: the original
            // bridge permits multiple pending RPCs and out-of-order responses.
            void (async () => {
              try {
                const result = await options.invoke(invoke, owner, scope.signal)
                receiver.push({ type: 'response', id: invoke.id, result })
              } catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error))
                const detail = failure as Error & { code?: string; status?: number }
                receiver.push({ type: 'response', id: invoke.id, error: {
                  name: failure.name, message: failure.message, code: detail.code, status: detail.status,
                } })
              }
            })()
          }
        },
        close() { receiver.close() },
        abort() { receiver.close() },
      })
      return { readable, writable }
    },
    onFilesDropped(listener: (event: { entries: readonly NativeDropEntry[] }) => void) {
      return options.onFilesDropped ? options.onFilesDropped(listener) : () => {}
    },
    dispose() {
      if (disposed) return
      disposed = true
      scope.abort()
      unsubscribe()
      for (const receiver of [...receivers]) receiver.close()
    },
  }
}
