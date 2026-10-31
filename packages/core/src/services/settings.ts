import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { defaultDataDir, type PathsConfig } from './paths.ts'
import type { SettingsApi } from '../contracts.ts'
import type { Settings } from '../types.ts'

/** Built-in defaults, mirroring HMCL's launcher settings. */
export function defaultSettings(): Settings {
  return {
    language: 'zh-CN',
    dataDir: null,
    concurrency: 8,
    mirrors: {
      versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      launcherMeta: 'https://launchermeta.mojang.com',
      assets: 'https://resources.download.minecraft.net',
      maven: 'https://libraries.minecraft.net',
      fabric: 'https://meta.fabricmc.net',
      forge: 'https://maven.minecraftforge.net',
      neoforge: 'https://maven.neoforged.net',
      quilt: 'https://meta.quiltmc.org',
      modrinth: 'https://api.modrinth.com',
      curseforge: 'https://api.curseforge.com',
    },
    proxy: { enabled: false, host: '', port: 7890 },
    autoDownloadJava: true,
    keepLogs: 10,
    showSnapshots: true,
    downloadSource: 'official',
    theme: 'archive',
    microsoftClientId: '',
  }
}

/** Mirror presets used by the `downloadSource` switch (BMCLAPI compatible). */
export function mirrorSettings(): Settings['mirrors'] {
  return {
    versionManifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
    launcherMeta: 'https://bmclapi2.bangbang93.com',
    assets: 'https://bmclapi2.bangbang93.com/assets',
    maven: 'https://bmclapi2.bangbang93.com/maven',
    fabric: 'https://bmclapi2.bangbang93.com/fabric-meta',
    forge: 'https://bmclapi2.bangbang93.com/maven',
    neoforge: 'https://bmclapi2.bangbang93.com/maven',
    quilt: 'https://bmclapi2.bangbang93.com/quilt-meta',
    modrinth: 'https://api.modrinth.com',
    curseforge: 'https://api.curseforge.com',
  }
}

/**
 * Launcher settings persisted in `launcher.json`.
 *
 * The service resolves defaults lazily so every consumer can read
 * `ctx.settings.resolved()` without caring about partial config files.
 */
export class SettingsService implements SettingsApi {
  static inject = ['storage', 'bus']

  private cache: Settings | undefined
  /** Data root the settings file lives in; refreshed whenever the user changes it. */
  private resolvedRoot: string | undefined

  constructor(protected ctx: Context) {
  }

  /**
   * Resolve the directory that holds launcher.json.
   *
   * Preference order: an explicit root passed at boot, the configured data
   * directory (read lazily to avoid a paths <-> settings cycle), then the
   * platform default.
   */
  private file(): string {
    const root = this.resolvedRoot ?? this.ctx.paths?.get?.()?.root ?? defaultDataDir()
    this.resolvedRoot = root
    return join(root, 'launcher.json')
  }

  /** Point the settings file at a new data root (called by paths.reset). */
  relocate(root: string): void {
    this.resolvedRoot = root
  }

  get(): Settings {
    if (this.cache) return this.cache
    const stored = this.ctx.storage.readSync<Partial<Settings>>(this.file(), {})
    this.cache = mergeSettings(defaultSettings(), stored)
    return this.cache
  }

  resolved(): Settings {
    const settings = this.get()
    if (settings.downloadSource === 'mirror') {
      return { ...settings, mirrors: { ...mirrorSettings(), ...pickCustom(settings.mirrors) } }
    }
    return settings
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = mergeSettings(this.get(), patch)
    // Changing the data directory must move the settings file too.
    if (patch.dataDir !== undefined) {
      this.resolvedRoot = patch.dataDir ?? defaultDataDir()
      this.ctx.paths?.reset?.(patch.dataDir ?? undefined)
    }
    this.cache = next
    await this.ctx.storage.write(this.file(), next)
    this.ctx.bus?.emit({ type: 'settings', settings: next })
    return next
  }

  /** Force a reload from disk (used by tests and after external edits). */
  reload(): Settings {
    this.cache = undefined
    return this.get()
  }
}

/** Only keep mirror entries the user actually changed. */
function pickCustom(mirrors: Settings['mirrors']): Partial<Settings['mirrors']> {
  const defaults = defaultSettings().mirrors
  const out: Partial<Settings['mirrors']> = {}
  for (const [key, value] of Object.entries(mirrors ?? {})) {
    if (typeof value === 'string' && value && value !== (defaults as any)[key]) {
      (out as any)[key] = value
    }
  }
  return out
}

function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  const next: Settings = { ...base }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue
    if (key === 'mirrors') {
      next.mirrors = { ...base.mirrors, ...(value as Settings['mirrors']) }
      continue
    }
    if (key === 'proxy') {
      next.proxy = { ...(base.proxy ?? { enabled: false, host: '', port: 7890 }), ...(value as Settings['proxy']) }
      continue
    }
    ;(next as any)[key] = value
  }
  next.concurrency = Math.min(64, Math.max(1, Math.round(Number(next.concurrency) || 8)))
  next.keepLogs = Math.min(200, Math.max(0, Math.round(Number(next.keepLogs) || 0)))
  return next
}

