'use strict'
// Electron 主进程（CJS）。窗口与协议范式沿用 deepseek-harness apps/desktop/src/main.ts。
const { app, BrowserWindow, ipcMain, nativeTheme, protocol, shell, session } = require('electron')
const { extname, resolve, sep, join } = require('node:path')
const { readFile } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const http = require('node:http')

const { APP_ORIGIN, SCHEME, isApplicationUrl, assertMainApplication, forwardWebRequest, websocketRequestHeaders } = require('./web-transport.cjs')
const { ensureBackend } = require('./backend.cjs')
const { createWindowPlugins } = require('./window-plugins.cjs')
let mainWindow, desktopBackend, windowPlugins, uiWatcher, quitting = false
let originalUi = process.env.RHINE_UI === 'ellan'
// dist lives at packages/web/dist next to this package.
let ROOT = originalUi ? resolve(__dirname, '../../ellan-ui/dist/renderer') : resolve(__dirname, '../../web/dist')
let ENTRY = originalUi ? 'index.html' : 'app.html'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
}

/** Serve one file from ROOT, refusing anything outside it. */
async function serve(request, root) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const url = new URL(request.url)
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
  const target = resolve(root, '.' + (pathname === '/' ? '/' + ENTRY : pathname))
  const directory = resolve(root)
  if (!target.startsWith(directory + sep)) return new Response(null, { status: 403 })
  let file
  try { file = await readFile(target) } catch (error) {
    if (error && error.code === 'ENOENT') return new Response(null, { status: 404 })
    throw error
  }
  if (originalUi && ['.html', '.js', '.css'].includes(extname(target))) {
    file = Buffer.from(file.toString('utf8').replaceAll('http://launcher', APP_ORIGIN + '/api/ellan-resource'))
  }
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(file), {
    headers: { 'content-type': MIME[extname(target)] || 'application/octet-stream' },
  })
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}])

function createWindow() {
  const options = {
    width: originalUi ? 1200 : 1280,
    height: originalUi ? 720 : 820,
    minWidth: originalUi ? 800 : 940,
    minHeight: originalUi ? 400 : 620,
    show: false,
    backgroundColor: originalUi ? '#eae5e1' : '#0b1a16',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      webviewTag: false,
      additionalArguments: ['--rhine-stream-base=' + desktopBackend.origin],
    },
  }
  if (process.platform === 'win32') {
    options.titleBarStyle = 'hidden'
    if (!originalUi) options.titleBarOverlay = {
      height: 40,
      color: '#0b1a16',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115',
    }
  }
  const window = new BrowserWindow(options)
  mainWindow = window
  window.once('closed', () => { if (mainWindow === window) mainWindow = undefined })
  window.once('ready-to-show', () => { if (!process.env.RHINE_DESKTOP_HIDDEN) window.show() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    const name = new URL(url).protocol
    if (name === 'https:' || name === 'http:') void shell.openExternal(url)
    return { action: 'deny' }
  })
  const allowed = (url) => {
    try {
      const parsed = new URL(url)
      return isApplicationUrl(parsed.href)
    } catch { return false }
  }
  window.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  window.webContents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault() })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('did-fail-load', (_e, code, description, url, isMain) => {
    if (isMain && code !== -3) console.error('[desktop] page failed:', url, code, description)
  })
  void window.loadURL(APP_ORIGIN + (originalUi ? '/index.html#/me' : '/app.html#/')).then(() => {
    if (!process.env.RHINE_DESKTOP_HIDDEN) { window.show(); window.focus() }
    console.log('[desktop] window ready:', window.webContents.id, 'visible=' + window.isVisible())
  }).catch(error => console.error('[desktop] page load failed:', error.message))
  return window
}

app.setName('Rhine Launcher')
if (process.env.RHINE_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.RHINE_DESKTOP_USER_DATA))
app.whenReady().then(async () => {
  await startBackend()
  if (!process.env.RHINE_UI) {
    const result = await fetch(desktopBackend.origin + '/api/ui/ellan')
    if (result.ok) {
      const ui = await result.json()
      if (ui.ready && ui.id === 'ui.ellan') { originalUi = true; ROOT = resolve(ui.root); ENTRY = ui.entry }
    }
  }
  windowPlugins = await createWindowPlugins(() => mainWindow)
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url)
    if (!isApplicationUrl(url.href)) return new Response(null, { status: 403 })
    if (!url.pathname.startsWith('/api/')) return serve(request, ROOT)
    try { return await forwardWebRequest(request, desktopBackend.origin) }
    catch (error) {
      console.error('[desktop] API request failed:', error.message)
      return Response.json({ code: 'BACKEND_UNAVAILABLE', message: '无法连接到启动器后端，请重试。' }, { status: 503 })
    }
  })
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    callback(websocketRequestHeaders(details, desktopBackend.origin, mainWindow?.webContents.id))
  })
  ipcMain.handle('rhine:open-external', (event, url) => {
    assertMainApplication(event, mainWindow)
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('refused url')
    return shell.openExternal(url)
  })
  ipcMain.handle('rhine:window-call', (event, channel, args) => {
    assertMainApplication(event, mainWindow)
    if (typeof channel !== 'string' || !channel.startsWith('window.') || !Array.isArray(args)) throw new Error('Invalid native call')
    return windowPlugins.call(channel, args)
  })
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  if (!process.env.RHINE_UI) {
    uiWatcher = new WebSocket(desktopBackend.origin.replace('http:', 'ws:') + '/ws')
    uiWatcher.addEventListener('message', async event => {
      try {
      let message; try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.type !== 'plugins' || quitting || !mainWindow) return
      const enabled = message.plugins?.some(p => p.id === 'ui.ellan' && p.status === 'enabled')
      if (enabled === originalUi) return
      if (enabled) {
        const response = await fetch(desktopBackend.origin + '/api/ui/ellan')
        if (!response.ok) return
        const ui = await response.json(); if (!ui.ready) return
        ROOT = resolve(ui.root); ENTRY = ui.entry
      } else { ROOT = resolve(__dirname, '../../web/dist'); ENTRY = 'app.html' }
      originalUi = enabled
      await mainWindow.loadURL(APP_ORIGIN + (originalUi ? '/index.html#/me' : '/app.html#/plugins'))
      } catch (error) { console.error('[desktop] UI switch failed:', error.message) }
    })
  }
}).catch(async error => {
  console.error('[desktop] startup failed:', error)
  if (!process.env.RHINE_DESKTOP_HIDDEN) require('electron').dialog.showErrorBox('启动器启动失败', error.message || String(error))
  await desktopBackend?.stop()
  app.exit(1)
})

/**
 * Own the backend process: the renderer is a static bundle, so the desktop host
 * starts the server itself and waits for /api/health before opening the window.
 */
const HOST = '127.0.0.1'
const PORT = Number(process.env.RHINE_PORT || 6550)
const API = 'http://' + HOST + ':' + PORT
let backend

function health() {
  return new Promise((resolve) => {
    const req = http.get(API + '/api/health', (res) => { res.resume(); resolve(res.statusCode === 200) })
    req.on('error', () => resolve(false))
    req.setTimeout(800, () => { req.destroy(); resolve(false) })
  })
}

async function startBackend() {
  const repo = resolve(__dirname, '../../..')
  desktopBackend = await ensureBackend({ repository: repo, port: PORT,
    dataDirectory: resolve(process.env.RHINE_DATA_DIR || join(repo, '.rhine-dev')),
    executable: process.env.RHINE_NODE || process.execPath })
  console.log('[desktop] backend ready:', desktopBackend.origin, desktopBackend.owned ? '(owned)' : '(existing)')
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', event => {
  if (quitting) return
  quitting = true
  uiWatcher?.close()
  event.preventDefault()
  Promise.resolve(desktopBackend?.stop()).finally(() => app.quit())
})
