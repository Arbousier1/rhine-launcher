'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')
if (location.protocol === 'rhine-app:' && location.hostname === 'app' && process.isMainFrame) {
  const prefix = '--rhine-stream-base='
  const streamBaseUrl = process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
  if (!streamBaseUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(streamBaseUrl)) throw new Error('Desktop backend origin is missing')
  const markDesktop = () => {
    document.documentElement.dataset.desktopPlatform = process.platform
  }
  if (document.documentElement) markDesktop()
  else document.addEventListener('DOMContentLoaded', markDesktop, { once: true })
  contextBridge.exposeInMainWorld('rhineDesktop', {
    protocolVersion: 1, platform: process.platform,
    apiBase: '', // HTTP remains same-origin; main proxies it to the owned backend.
    streamBaseUrl,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    windowCall: (channel, args) => ipcRenderer.invoke('rhine:window-call', channel, args),
    nativeFilePath: file => webUtils.getPathForFile(file),
    openExternal: url => {
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('Refused URL')
      return ipcRenderer.invoke('rhine:open-external', url)
    },
  })
}
