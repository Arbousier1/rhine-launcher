/**
 * Entry point: installs the stylesheet order, registers every feature plugin,
 * starts their setup effects and mounts the shell.
 *
 * The host does not prime the theme or install the motion failsafe itself —
 * those are effect plugins (app.theme-prime, motion.failsafe) that run inside
 * webPlugins.start().
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/ui.css'
import '@/styles/app.css'
import '@/styles/launch.css'
import '@/motion/motion.css'
import '@/plugins/catalog.ts'
import { webPlugins } from '@/plugins/registry.ts'
import { App } from '@/app/App.tsx'
import { AppRoutes } from '@/app/routes.tsx'

if(!location.hash)history.replaceState(null,'',location.pathname+'#/settings')
const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')
const root: HTMLElement = container

async function boot(): Promise<void> {
  try {
    // Runs setup() for every enabled effect feature (theme priming, the rAF
    // failsafe). A failing plugin is rolled back by the registry, never fatal.
    await webPlugins.start()
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('[rhine] feature start failed', error)
  }

  createRoot(root).render(
    <StrictMode>
      <HashRouter>
        <App>
          <AppRoutes />
        </App>
      </HashRouter>
    </StrictMode>,
  )
}

void boot()