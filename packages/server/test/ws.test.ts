/**
 * WebSocket hub tests.
 *
 * These use a real `node:http` server on an ephemeral port and a real `ws`
 * client: the upgrade path, the bootstrap frame, bus fan-out and the
 * disconnect cleanup are all transport behaviour that a mock would not cover.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { getRequestListener } from '@hono/node-server'
import { createServerApp } from '../src/app.ts'
import { attachWebSocket, isWsRequest } from '../src/ws.ts'
import type { ServerEvent } from '@rhine/core'
import { createMockContext } from './mock-context.ts'

/** Resources created by one test, torn down afterwards. */
interface Harness {
  server: Server
  url: string
  dispose: () => Promise<void>
  mock: ReturnType<typeof createMockContext>
}

const open: Harness[] = []

/** A client that buffers every frame so no event can be missed. */
interface WireClient {
  socket: WebSocket
  /** Wait for the next frame, or take one that already arrived. */
  next(timeoutMs?: number): Promise<Record<string, unknown>>
  close(): void
}

/**
 * Connect and start buffering immediately.
 *
 * The server pushes the bootstrap frame the moment the connection is
 * established, which can be before the caller's first `await` resumes, so the
 * listener must be installed before the socket opens.
 */
function connect(url: string): Promise<WireClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const queue: Record<string, unknown>[] = []
    const waiters: ((frame: Record<string, unknown>) => void)[] = []

    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
      const waiter = waiters.shift()
      if (waiter) waiter(frame)
      else queue.push(frame)
    })
    socket.once('error', reject)

    const client: WireClient = {
      socket,
      next(timeoutMs = 3000) {
        const queued = queue.shift()
        if (queued) return Promise.resolve(queued)
        return new Promise((resolveFrame, rejectFrame) => {
          const timer = setTimeout(() => rejectFrame(new Error('等待 WebSocket 消息超时')), timeoutMs)
          waiters.push((frame) => {
            clearTimeout(timer)
            resolveFrame(frame)
          })
        })
      },
      close() {
        socket.close()
      },
    }

    socket.once('open', () => resolve(client))
  })
}

/** Start a real HTTP + WS server around the mock context. */
async function start(): Promise<Harness> {
  const mock = createMockContext()
  await mock.ctx.features.settled()
  const app = createServerApp(mock.ctx)
  const server = createServer(getRequestListener(app.fetch))
  const handle = attachWebSocket(server, mock.ctx)
  const dispose = () => handle.dispose()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const harness: Harness = { server, url: `ws://127.0.0.1:${port}/ws`, dispose, mock }
  open.push(harness)
  return harness
}

/** Give the event loop a turn so server-side cleanup can run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

afterEach(async () => {
  while (open.length) {
    const harness = open.pop()!
    await harness.dispose()
    await new Promise<void>((resolve) => harness.server.close(() => resolve()))
  }
})

describe('isWsRequest', () => {
  it('accepts the socket path with and without a query string', () => {
    expect(isWsRequest('/ws')).toBe(true)
    expect(isWsRequest('/ws?token=1')).toBe(true)
    expect(isWsRequest('/ws/')).toBe(true)
  })

  it('rejects other paths', () => {
    expect(isWsRequest('/api/ws')).toBe(false)
    expect(isWsRequest('/wss')).toBe(false)
    expect(isWsRequest(undefined)).toBe(false)
  })
})

describe('WebSocket hub', () => {
  it('pushes the bootstrap snapshot as the first frame', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    const frame = await client.next()
    expect(frame.type).toBe('bootstrap')
    const bootstrap = frame.bootstrap as { paths: { root: string }; instances: unknown[]; app: { name: string } }
    expect(bootstrap.paths.root).toBe('C:/rhine-data')
    expect(bootstrap.instances).toHaveLength(1)
    expect(bootstrap.app.name).toBe('Rhine Launcher')
    client.close()
  })

  it('broadcasts ServerEvents emitted on the bus', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    await client.next() // bootstrap

    const event: ServerEvent = { type: 'notice', level: 'info', message: '版本清单已刷新' }
    const waiting = client.next()
    harness.mock.emit(event)
    expect(await waiting).toEqual(event)
    client.close()
  })

  it('fans out one event to every connected client', async () => {
    const harness = await start()
    const first = await connect(harness.url)
    const second = await connect(harness.url)
    await first.next()
    await second.next()

    const firstFrame = first.next()
    const secondFrame = second.next()
    harness.mock.emit({ type: 'instance-removed', id: 'archive-1' })
    expect(await firstFrame).toEqual({ type: 'instance-removed', id: 'archive-1' })
    expect(await secondFrame).toEqual({ type: 'instance-removed', id: 'archive-1' })
    first.close()
    second.close()
  })

  it('answers a client ping with a pong', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    await client.next()
    client.socket.send(JSON.stringify({ type: 'ping' }))
    const frame = await client.next()
    expect(frame.type).toBe('pong')
    expect(typeof frame.time).toBe('number')
    client.close()
  })

  it('re-sends the bootstrap on request', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    await client.next()
    client.socket.send(JSON.stringify({ type: 'bootstrap' }))
    const frame = await client.next()
    expect(frame.type).toBe('bootstrap')
    client.close()
  })

  it('reports an unparseable frame as a notice instead of dying', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    await client.next()
    client.socket.send('not json')
    const frame = await client.next()
    expect(frame.type).toBe('notice')
    expect(client.socket.readyState).toBe(WebSocket.OPEN)
    client.close()
  })

  it('drops the subscription when the server is disposed', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    await client.next()
    expect(harness.mock.subscribers()).toBe(1)
    await harness.dispose()
    open.pop()
    await new Promise<void>((resolve) => harness.server.close(() => resolve()))
    expect(harness.mock.subscribers()).toBe(0)
    client.close()
  })

  it('stops tracking a client after it disconnects', async () => {
    const harness = await start()
    const client = await connect(harness.url)
    await client.next()
    client.close()
    await tick()
    // A broadcast after the disconnect must not throw or resurrect the socket.
    expect(() => harness.mock.emit({ type: 'notice', level: 'info', message: 'after close' })).not.toThrow()
  })

  it('refuses an upgrade on a foreign path', async () => {
    const harness = await start()
    const address = harness.server.address() as AddressInfo
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/nope`)
    const outcome = await new Promise<string>((resolve) => {
      socket.once('open', () => resolve('open'))
      socket.once('error', () => resolve('error'))
    })
    expect(outcome).toBe('error')
  })
})
