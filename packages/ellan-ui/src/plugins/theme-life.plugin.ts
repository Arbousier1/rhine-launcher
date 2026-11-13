import { defineFeature } from '@rhine/plugin-api'
import themeCss from '../styles/theme-life.css?inline'

const FEATURE_ID = 'ui.theme.rhine-life'
const THEME = 'rhine-life'
const THEME_ATTRIBUTE = 'data-rhine-theme'
const MODE_ATTRIBUTE = 'data-rhine-theme-mode'

// Exact light/dark swatches from .reference/RhineLabUI/src/theme-ui.ts.
const palettes = {
  light: {
    ink: '#080a08', muted: '#77756d', line: '#aaa59a', paper: '#eae5e1',
    panel: '#edebe4', field: '#e7e3d9', accent: '#9b7247',
  },
  dark: {
    ink: '#e0e3dc', muted: '#a6b0b1', line: '#536166', paper: '#11181b',
    panel: '#202a2f', field: '#2a363b', accent: '#c5a16b',
  },
} as const

export interface RhineLifeThemeMetadata {
  id: typeof FEATURE_ID
  theme: typeof THEME
  mode: keyof typeof palettes
  active: boolean
  palette: Record<keyof typeof palettes.light, string>
}

function restoreAttribute(root: HTMLElement, name: string, previous: string | null) {
  if (previous === null) root.removeAttribute(name)
  else root.setAttribute(name, previous)
}

/** Style-only feature: importing the inline CSS never activates the theme. */
export default defineFeature<void, RhineLifeThemeMetadata>({
  id: FEATURE_ID,
  capability: FEATURE_ID,
  title: '莱茵生命 · 暖纸主题',
  description: '以暖纸、细线和琥珀标记整理原 Vue 界面，保留组件、图标与业务行为。',
  tags: ['ui', 'theme'],
  setup(env) {
    if (typeof document === 'undefined') return
    env.signal.throwIfAborted()
    const root = document.documentElement
    const previousTheme = root.getAttribute(THEME_ATTRIBUTE)
    const previousMode = root.getAttribute(MODE_ATTRIBUTE)
    const style = document.createElement('style')
    style.setAttribute('data-rhine-theme-style', THEME)
    style.textContent = themeCss
    let disposed = false
    env.onDispose(() => {
      if (disposed) return
      disposed = true
      style.remove()
      // A subsequently selected, different theme owns its own attributes.
      if (root.getAttribute(THEME_ATTRIBUTE) !== THEME) return
      restoreAttribute(root, MODE_ATTRIBUTE, previousMode)
      restoreAttribute(root, THEME_ATTRIBUTE, previousTheme)
    })
    // Do not rewrite the original Vue theme, stored preferences or inline tokens.
    root.setAttribute(THEME_ATTRIBUTE, THEME)
    root.setAttribute(MODE_ATTRIBUTE, 'light')
    document.head.append(style)
  },
  execute(_input, env) {
    env.signal.throwIfAborted()
    const root = typeof document === 'undefined' ? undefined : document.documentElement
    const mode = root?.getAttribute(MODE_ATTRIBUTE) === 'dark' ? 'dark' : 'light'
    return {
      id: FEATURE_ID,
      theme: THEME,
      mode,
      active: root?.getAttribute(THEME_ATTRIBUTE) === THEME,
      palette: { ...palettes[mode] },
    }
  },
})
