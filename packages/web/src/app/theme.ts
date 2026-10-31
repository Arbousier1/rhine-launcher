/**
 * Theme + locale plumbing for the shell.
 *
 * The shell is the single owner of `document.documentElement.dataset.theme`;
 * erin's settings page writes the same attribute, so application here is
 * idempotent and only ever reflects the value already stored in settings.
 *
 * Locale lives in a tiny external store (not React state) because the top bar
 * and every page render independent subtrees: a per-component state would let
 * the switch update the toolbar but not the page body.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAppStore } from './data.ts'
import { createTranslator, normalizeLocale } from './i18n.ts'
import type { Locale, Translator } from './i18n.ts'

export type ThemeName = 'archive' | 'midnight' | 'light'

export const THEMES: ThemeName[] = ['archive', 'midnight', 'light']

const THEME_STORAGE_KEY = 'rhine.theme'

/** Write the theme attribute, the color-scheme meta and the local cache. */
export function applyTheme(theme: string | undefined | null): ThemeName {
  const value: ThemeName = theme === 'midnight' || theme === 'light' ? theme : 'archive'
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = value
    const meta = document.querySelector('meta[name="color-scheme"]')
    if (meta) meta.setAttribute('content', value === 'midnight' ? 'dark' : 'light')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      /* private mode: the in-memory attribute is enough */
    }
  }
  return value
}

/** Keep the document in sync with the stored settings theme. */
export function useThemeSync(): ThemeName {
  const theme = useAppStore((state) => state.settings?.theme)
  const [applied, setApplied] = useState<ThemeName>(() => applyTheme(theme))
  useEffect(() => {
    setApplied(applyTheme(theme))
  }, [theme])
  return applied
}

/* ------------------------------------------------------------------ */
/* locale store                                                        */
/* ------------------------------------------------------------------ */

let localeOverride: Locale | null = null
const localeListeners = new Set<() => void>()

/** Override the language for this session (until reload). */
export function setLocaleOverride(locale: Locale | null): void {
  if (localeOverride === locale) return
  localeOverride = locale
  for (const listener of localeListeners) listener()
}

/** Current override, exposed for tests and non-React call sites. */
export function currentLocaleOverride(): Locale | null {
  return localeOverride
}

function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener)
  return () => {
    localeListeners.delete(listener)
  }
}

function browserLocale(): string | null {
  if (typeof navigator === 'undefined') return null
  return navigator.language ?? null
}

export interface I18n {
  locale: Locale
  t: Translator
  setLocale: (locale: Locale) => void
}

/**
 * Resolve the active locale: the session override wins, then the stored
 * settings value, then the browser language.
 */
export function useI18n(): I18n {
  const stored = useAppStore((state) => state.settings?.language)
  const override = useSyncExternalStore(
    subscribeLocale,
    () => localeOverride,
    () => null,
  )
  const locale = normalizeLocale(override ?? stored ?? browserLocale())
  const t = useMemo(() => createTranslator(locale), [locale])
  const setLocale = useCallback((next: Locale) => setLocaleOverride(next), [])
  return { locale, t, setLocale }
}

/** Format a timestamp as YYYY-MM-DD HH:mm in the user's locale. */
export function formatDateTime(timestamp: number | undefined): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) +
    ':' + pad(date.getMinutes())
  )
}

/** Short date only. */
export function formatDate(value: string | number | undefined): string {
  if (value === undefined) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}
