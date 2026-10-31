/**
 * app.theme-prime — applies the persisted theme before the first paint so the
 * paper colour never flashes. The previous attribute value is restored through
 * env.onDispose() when the feature is switched off.
 */
import { defineFeature } from '../../define.ts'

const STORAGE_KEY = 'rhine.theme'
const THEMES = ['archive', 'midnight', 'light']

function readStoredTheme(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && THEMES.includes(stored) ? stored : null
  } catch {
    return null
  }
}

export default defineFeature({
  id: 'app.theme-prime',
  capability: 'app.theme-prime',
  title: '主题预热',
  description: '首屏渲染前套用本地保存的配色，避免纸张底色闪烁。',
  kind: 'effect',
  order: 10,
  setup(env) {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const previous = root.getAttribute('data-theme')
    const stored = readStoredTheme()
    if (stored) root.setAttribute('data-theme', stored)
    env.onDispose(() => {
      if (previous === null) root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', previous)
    })
  },
})
