'use strict'
const { FeatureRuntime, defineFeature } = require('../dist/feature-runtime.cjs')
const { BrowserWindow, clipboard, dialog, screen, systemPreferences } = require('electron')
const implementations = [
  ['desktop.window.show', ctx => ctx.window().show()],
  ['desktop.window.hide', ctx => ctx.window().hide()],
  ['desktop.window.close', ctx => ctx.window().close()],
  ['desktop.window.minimize', ctx => ctx.window().minimize()],
  ['desktop.window.maximize', ctx => { const w=ctx.window(); w.isMaximized()?w.unmaximize():w.maximize() }],
  ['desktop.window.focus', ctx => ctx.window().focus()],
  ['desktop.window.flash', ctx => ctx.window().flashFrame(true)],
  ['desktop.window.monitors', () => screen.getAllDisplays().map(d=>({id:d.id,...d.bounds,scale:d.scaleFactor,primary:d.id===screen.getPrimaryDisplay().id}))],
  ['desktop.clipboard.write', (_ctx,args) => { if(typeof args[0]!=='string')throw new Error('Clipboard requires text');clipboard.writeText(args[0]) }],
  ['desktop.dialog.open', (ctx,args) => dialog.showOpenDialog(ctx.window(),args[0]||{})],
  ['desktop.dialog.save', (ctx,args) => dialog.showSaveDialog(ctx.window(),args[0]||{})],
  ['desktop.window.audio-permission', () => systemPreferences.getMediaAccessStatus('microphone')==='granted'],
  ['desktop.window.translucent', (ctx,args) => { const w=ctx.window();if(process.platform==='win32')w.setBackgroundMaterial(args[0]?'acrylic':'none');else if(process.platform==='darwin')w.setVibrancy(args[0]?'sidebar':null) }],
  ['desktop.window.find', (ctx,args) => ctx.window().webContents.findInPage(String(args[0]),args[1])],
  ['desktop.window.find-stop', ctx => ctx.window().webContents.stopFindInPage('clearSelection')],
]
const channels = {
 'window.focus':'desktop.window.focus', 'window.flash-frame':'desktop.window.flash',
 'window.get-monitors':'desktop.window.monitors', 'window.query-audio-permission':'desktop.window.audio-permission',
 'window.write-clipboard':'desktop.clipboard.write', 'window.show-open-dialog':'desktop.dialog.open',
 'window.show-save-dialog':'desktop.dialog.save', 'window.set-translucent':'desktop.window.translucent',
 'window.find-in-page':'desktop.window.find', 'window.stop-find-in-page':'desktop.window.find-stop',
}
async function createWindowPlugins(getWindow) {
 const runtime=new FeatureRuntime()
 const context={window(){const w=getWindow();if(!w||w.isDestroyed())throw new Error('Window is unavailable');return w}}
 for(const [id,execute] of implementations) runtime.register(defineFeature({id,capability:id,title:id,execute:args=>execute(context,args||[])}))
 await runtime.start()
 return {
   async call(channel,args){
     const id=channel==='window.control'&&typeof args[0]==='string'?'desktop.window.'+args[0]:channels[channel]
     if(!id||!runtime.has(id))throw new Error('Native window operation is unavailable: '+channel)
     return runtime.call(id,channel==='window.control'?args.slice(1):args)
   },
   dispose:()=>runtime.dispose(),
 }
}
module.exports={createWindowPlugins}
