/**
 * Route inventory test.
 *
 * Guards the exact paths the web client depends on: a rename here would break
 * `packages/web/src/api/client.ts` at runtime without any compile error.
 */
import { describe, expect, it } from 'vitest'
import { createServerApp } from '../src/app.ts'
import { createMockContext } from './mock-context.ts'

/** Build an app over a fresh mock context. */
function app() {
  const mock = createMockContext({
    diagnostics: { analyze: async () => [] },
  })
  return { mock, server: createServerApp(mock.ctx) }
}

/** Every endpoint the web client calls, with the method it uses. */
const ROUTES: { method: string; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/bootstrap' },
  { method: 'GET', path: '/api/versions/remote' },
  { method: 'GET', path: '/api/versions/installed' },
  { method: 'POST', path: '/api/versions/install', body: { gameVersion: '1.21.4' } },
  { method: 'GET', path: '/api/versions/1.21.4/loaders' },
  { method: 'GET', path: '/api/loaders/fabric?gameVersion=1.21.4' },
  { method: 'POST', path: '/api/loaders/fabric/install', body: { gameVersion: '1.21.4', loaderVersion: '0.16.9' } },
  { method: 'GET', path: '/api/instances' },
  { method: 'GET', path: '/api/instances/archive-1' },
  { method: 'POST', path: '/api/instances', body: { name: 'x', gameVersion: '1.21.4' } },
  { method: 'PATCH', path: '/api/instances/archive-1', body: { name: 'y' } },
  { method: 'DELETE', path: '/api/instances/archive-1' },
  { method: 'POST', path: '/api/instances/archive-1/duplicate', body: { name: 'z' } },
  { method: 'GET', path: '/api/instances/archive-1/files?subdir=mods' },
  { method: 'GET', path: '/api/instances/archive-1/file?path=options.txt' },
  { method: 'PUT', path: '/api/instances/archive-1/file', body: { path: 'options.txt', content: 'a' } },
  { method: 'DELETE', path: '/api/instances/archive-1/file?path=options.txt' },
  { method: 'GET', path: '/api/instances/archive-1/mods' },
  { method: 'POST', path: '/api/instances/archive-1/mods', body: { url: 'https://x.invalid/a.jar', fileName: 'a.jar' } },
  { method: 'POST', path: '/api/instances/archive-1/mods/sodium.jar/toggle', body: { enabled: false } },
  { method: 'DELETE', path: '/api/instances/archive-1/mods/sodium.jar' },
  { method: 'GET', path: '/api/instances/archive-1/diagnostics' },
  { method: 'GET', path: '/api/market/search?source=modrinth&query=sodium' },
  { method: 'GET', path: '/api/market/modrinth/project/AANobbMI' },
  { method: 'GET', path: '/api/market/modrinth/AANobbMI/versions' },
  {
    method: 'POST',
    path: '/api/market/install',
    body: {
      instanceId: 'archive-1',
      version: { source: 'modrinth', id: 'v', file: { url: 'https://x.invalid/a.jar', fileName: 'a.jar' } },
    },
  },
  { method: 'POST', path: '/api/launch', body: { instanceId: 'archive-1', accountId: 'offline-steve' } },
  { method: 'POST', path: '/api/launch/build', body: { instanceId: 'archive-1', accountId: 'offline-steve' } },
  { method: 'GET', path: '/api/launch/sessions' },
  { method: 'GET', path: '/api/launch/sessions/session-1' },
  { method: 'GET', path: '/api/launch/sessions/session-1/log?tail=100' },
  { method: 'POST', path: '/api/launch/sessions/session-1/kill' },
  { method: 'GET', path: '/api/accounts' },
  { method: 'GET', path: '/api/accounts/offline-steve' },
  { method: 'POST', path: '/api/accounts/offline', body: { name: 'Alex' } },
  { method: 'DELETE', path: '/api/accounts/offline-steve' },
  { method: 'POST', path: '/api/accounts/microsoft/start' },
  { method: 'POST', path: '/api/accounts/microsoft/complete' },
  { method: 'POST', path: '/api/accounts/offline-steve/refresh' },
  { method: 'POST', path: '/api/accounts/offline-steve/authorize' },
  { method: 'GET', path: '/api/settings' },
  { method: 'PATCH', path: '/api/settings', body: { theme: 'archive' } },
  { method: 'GET', path: '/api/tasks' },
  { method: 'GET', path: '/api/tasks/task-1' },
  { method: 'POST', path: '/api/tasks/task-1/cancel' },
  { method: 'GET', path: '/api/java' },
  { method: 'POST', path: '/api/java/scan' },
  { method: 'POST', path: '/api/java/install', body: { component: 'java-runtime-gamma' } },
]

describe('route inventory', () => {
  it.each(ROUTES)('$method $path is registered', async ({ method, path, body }) => {
    const { server } = app()
    const response = await server.request(path, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
    // 405 would mean the path exists but the method is missing; 404 the reverse.
    expect(response.status).not.toBe(404)
    expect(response.status).not.toBe(405)
  })

  it('exposes system routes from individual capability metadata, not grouped Hono routers', async () => {
    const { mock, server } = app()
    await mock.ctx.features.settled()
    const routes = mock.ctx.features.definitions().filter(feature=>feature.http).map(feature=>feature.http!.method+' '+feature.http!.path)
    expect(server.routes.some(route=>route.path==='/api/loaders/:kind/install')).toBe(false)
    expect(routes).toContain('POST /api/system/reveal')
    expect(routes).toContain('POST /api/system/open')
    expect(routes).toContain('POST /api/instances/:id/mods/import')
    expect(routes).toContain('POST /api/versions/install')
    expect(routes).toContain('POST /api/loaders/fabric/install')
    expect(routes).toContain('POST /api/loaders/quilt/install')
    expect(routes).toContain('POST /api/loaders/neoforge/install')
    expect(routes).toContain('GET /api/instances/:id/diagnostics')
  })
})
