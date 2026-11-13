import { describe, it, expect, vi } from 'vitest'
import { APP_ORIGIN, isApplicationUrl, assertMainApplication, forwardWebRequest, websocketRequestHeaders } from '../src/web-transport.cjs'
const host = 'http://127.0.0.1:16789'

describe('desktop same-origin HTTP forwarding', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('preserves %s JSON, query and status without exposing upstream cookies', async method => {
    const controller = new AbortController()
    const path = '/api/instances/' + encodeURIComponent('验证实例') + '?deleteFiles=true'
    const payload = JSON.stringify({ name: '测试 "实例"', maxMemory: 4096 })
    const request = new Request(APP_ORIGIN + path, { method, body: payload, signal: controller.signal,
      headers: { Origin: APP_ORIGIN, Cookie: 'untrusted', Authorization: 'untrusted', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' } })
    const fetcher = vi.fn<typeof fetch>(async (target, options) => {
      expect(String(target)).toBe(host + path)
      expect(options?.redirect).toBe('manual')
      expect(options?.method).toBe(method)
      expect(options?.signal).toBe(request.signal)
      const headers = new Headers(options?.headers)
      expect(headers.get('origin')).toBe(host)
      expect(headers.get('sec-fetch-site')).toBe('same-origin')
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('content-type')).toBe('application/json')
      expect(await new Response(options?.body).text()).toBe(payload)
      return new Response('{"taskId":"任务-1"}', { status: 202, headers: {
        'content-type': 'application/json', 'set-cookie': 'private=1', 'content-encoding': 'gzip', 'content-length': '123', 'connection': 'keep-alive',
      } })
    })
    const result = await forwardWebRequest(request, host, fetcher)
    expect(result.status).toBe(202)
    expect(await result.json()).toEqual({ taskId: '任务-1' })
    for (const name of ['set-cookie', 'content-encoding', 'content-length', 'connection']) expect(result.headers.get(name)).toBeNull()
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
  it('supports same-origin GET with no Origin header', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_target, options) => {
      expect(options?.body).toBeUndefined()
      return Response.json({ app: 'Rhine Launcher' })
    })
    const result = await forwardWebRequest(new Request(APP_ORIGIN + '/api/bootstrap'), host, fetcher)
    expect(result.status).toBe(200)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['https://attacker.invalid', 'null', 'rhine-app://other'])('rejects supplied foreign Origin %s before any forwarding', async origin => {
    const fetcher = vi.fn<typeof fetch>()
    const result = await forwardWebRequest(new Request(APP_ORIGIN + '/api/bootstrap', { headers: { origin } }), host, fetcher)
    expect(result.status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['rhine-app://other/api/bootstrap', 'rhine-app://app:99/api/bootstrap', 'rhine-app://user@app/api/bootstrap', APP_ORIGIN + '/assets/main.js'])('rejects unowned proxy URL %s', async url => {
    const fetcher = vi.fn<typeof fetch>()
    if (url.includes('user@')) {
      // WHATWG Request rejects embedded credentials before a request exists.
      expect(isApplicationUrl(url)).toBe(false)
      expect(() => new Request(url)).toThrow('credentials')
      expect(fetcher).not.toHaveBeenCalled()
      return
    }
    expect((await forwardWebRequest(new Request(url), host, fetcher)).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses arbitrary backend destinations and never follows redirect responses', async () => {
    const request = new Request(APP_ORIGIN + '/api/bootstrap')
    await expect(forwardWebRequest(request, 'https://attacker.invalid')).rejects.toThrow('loopback')
    const fetcher = vi.fn<typeof fetch>(async (_target, options) => {
      expect(options?.redirect).toBe('manual')
      return new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } })
    })
    const response = await forwardWebRequest(request, host, fetcher)
    expect(response.status).toBe(302)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})

describe('desktop WebSocket and IPC ownership', () => {
  it('rewrites only the owning window and exact backend event endpoint', () => {
    const result = websocketRequestHeaders({ url: host.replace('http:', 'ws:') + '/ws', webContentsId: 7,
      requestHeaders: { Origin: APP_ORIGIN, Cookie: 'untrusted', Authorization: 'untrusted' } }, host, 7)
    expect(result).toEqual({ requestHeaders: { origin: host, 'sec-fetch-site': 'same-origin' } })
  })
  it.each([
    ['ws://127.0.0.1:16789/ws', 99],
    ['ws://127.0.0.1:16790/ws', 7],
    ['ws://127.0.0.1:16789/other', 7],
    ['wss://127.0.0.1:16789/ws', 7],
  ])('does not inject credentials into %s from window %s', (url, webContentsId) => {
    expect(websocketRequestHeaders({ url, webContentsId, requestHeaders: { Origin: APP_ORIGIN } }, host, 7)).toEqual({})
  })
  it('cancels a foreign origin trying to use the primary event endpoint', () => {
    expect(websocketRequestHeaders({ url: host.replace('http:', 'ws:') + '/ws', webContentsId: 7,
      requestHeaders: { Origin: 'https://attacker.invalid' } }, host, 7)).toEqual({ cancel: true })
  })
  it('validates parsed application authority rather than custom URL.origin', () => {
    expect(isApplicationUrl(APP_ORIGIN + '/#/')).toBe(true)
    for (const value of ['rhine-app://other/', 'rhine-app://app:1/', 'rhine-app://user@app/', 'file:///tmp/index.html', 'not a URL']) expect(isApplicationUrl(value)).toBe(false)
  })
  it('rejects iframe, non-owning window and destroyed-owner IPC', () => {
    const mainFrame = { url: APP_ORIGIN + '/' }
    const contents = { mainFrame }
    const owner = { webContents: contents, isDestroyed: () => false }
    expect(() => assertMainApplication({ sender: contents, senderFrame: mainFrame }, owner)).not.toThrow()
    expect(() => assertMainApplication({ sender: contents, senderFrame: { url: APP_ORIGIN + '/' } }, owner)).toThrow('non-primary')
    expect(() => assertMainApplication({ sender: { mainFrame }, senderFrame: mainFrame }, owner)).toThrow('non-primary')
    expect(() => assertMainApplication({ sender: contents, senderFrame: mainFrame }, { ...owner, isDestroyed: () => true })).toThrow('non-primary')
  })
})
