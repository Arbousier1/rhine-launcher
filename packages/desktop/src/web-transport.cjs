'use strict'
/**
 * Adapted from DeepSeek Harness apps/desktop/src/web-document.ts (MIT).
 * Copyright (c) 2026 DeepSeek. See ../LICENSES/DeepSeek-Harness-MIT.txt.
 * HTTP stays on the application origin. WebSocket headers are rewritten only
 * for the owning main frame and the exact loopback event endpoint.
 */
const APP_ORIGIN = 'rhine-app://app'
const SCHEME = 'rhine-app'
const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie', 'content-encoding', 'content-length', 'transfer-encoding',
  'connection', 'keep-alive', 'te', 'trailer', 'upgrade',
  'proxy-authenticate', 'proxy-authorization',
]

function isApplicationUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === SCHEME + ':' && url.hostname === 'app'
      && !url.port && !url.username && !url.password
  } catch { return false }
}

function assertMainApplication(event, window) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || event.senderFrame !== event.sender.mainFrame || !isApplicationUrl(event.senderFrame.url)) {
    throw new Error('Rejected IPC from a non-primary application frame')
  }
}

function loopbackHost(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password) throw new Error('Desktop backend must use its loopback HTTP origin')
  return url
}

/** Preserve method, body, streaming and cancellation; never follow redirects. */
async function forwardWebRequest(request, host, fetcher = fetch) {
  const source = new URL(request.url)
  const origin = request.headers.get('origin')
  if (!isApplicationUrl(source.href) || !source.pathname.startsWith('/api/')
    || (origin !== null && origin !== APP_ORIGIN)) {
    return new Response(null, { status: 403 })
  }
  const target = loopbackHost(host)
  target.pathname = source.pathname
  target.search = source.search
  const headers = new Headers(request.headers)
  for (const name of ['host', 'origin', 'cookie', 'authorization', 'sec-fetch-site', 'content-length', 'connection']) headers.delete(name)
  headers.set('origin', target.origin)
  headers.set('sec-fetch-site', 'same-origin')
  const init = {
    method: request.method, headers, signal: request.signal,
    redirect: 'manual',
    ...(request.body === null ? {} : { body: request.body, duplex: 'half' }),
  }
  const response = await fetcher(target, init)
  const outgoing = new Headers(response.headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  outgoing.set('cache-control', 'no-store')
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers: outgoing,
  })
}

/** Mirrors DSH main.ts's owned-window, exact-target WebSocket header gate. */
function websocketRequestHeaders(details, host, ownerId) {
  if (!host || details.webContentsId !== ownerId) return {}
  const target = loopbackHost(host)
  const requested = new URL(details.url)
  if (requested.protocol !== 'ws:' || requested.host !== target.host || requested.pathname !== '/ws'
    || requested.username || requested.password) return {}
  const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
  if (headers.origin !== APP_ORIGIN) return { cancel: true }
  delete headers.cookie
  delete headers.authorization
  return { requestHeaders: { ...headers, origin: target.origin, 'sec-fetch-site': 'same-origin' } }
}

module.exports = { APP_ORIGIN, SCHEME, isApplicationUrl, assertMainApplication, forwardWebRequest, websocketRequestHeaders }
