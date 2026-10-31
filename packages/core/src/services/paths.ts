import type { Context } from '@deepseek-ai/cordis'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PathsApi, RhPaths } from '../contracts.ts'

/** Directory name under the user data folder that holds launcher state. */
export const APP_DIR_NAME = 'RhineLauncher'

/**
 * Resolve the default launcher data directory.
 *
 * Follows DSH's `@deepseek-ai/dsh-home-paths` conventions: an explicit
 * `RHINE_HOME` environment override wins, then the platform data folder.
 */
export function defaultDataDir(): string {
  const override = process.env.RHINE_HOME
  if (override) return resolve(expand(override))
  const appData = process.env.APPDATA
  if (process.platform === 'win32' && appData) return join(appData, APP_DIR_NAME)
  return join(homedir(), '.' + APP_DIR_NAME)
}

function expand(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

export interface PathsConfig {
  /** Explicit data root; defaults to {@link defaultDataDir}. */
  root?: string
}

/**
 * Owns the launcher directory layout.
 *
 * The layout mirrors HMCL: `versions/`, `libraries/`, `assets/` and
 * `instances/<id>/` where every instance directory *is* a `.minecraft` folder.
 */
export class PathsService implements PathsApi {

  private current: RhPaths | undefined
  private readonly rootOverride: string | undefined

  constructor(protected ctx: Context, config: PathsConfig = {}) {
    this.rootOverride = config.root
  }

  get(): RhPaths {
    if (this.current) return this.current
    // Never consult ctx.settings here: the settings service stores launcher.json
    // under this very root, so reading settings from paths would recurse forever.
    // main.ts applies a user-configured data directory with reset() after boot.
    this.current = buildPaths(this.rootOverride ?? defaultDataDir())
    return this.current
  }

  /** Recompute the layout, e.g. after the user changed the data directory. */
  reset(root?: string): RhPaths {
    const next = root ?? this.current?.root ?? defaultDataDir()
    this.current = buildPaths(next)
    this.ctx.settings?.relocate?.(next)
    return this.current
  }

  instance(id: string): string {
    return join(this.get().instances, sanitizeId(id))
  }

  async ensure(): Promise<void> {
    const paths = this.get()
    await Promise.all([
      mkdir(paths.instances, { recursive: true }),
      mkdir(paths.assets, { recursive: true }),
      mkdir(paths.libraries, { recursive: true }),
      mkdir(paths.versions, { recursive: true }),
      mkdir(paths.java, { recursive: true }),
      mkdir(paths.logs, { recursive: true }),
      mkdir(paths.temp, { recursive: true }),
    ])
  }
}

/** Build the full path record for a launcher root. */
export function buildPaths(root: string): RhPaths {
  const base = resolve(root)
  return {
    root: base,
    instances: join(base, 'instances'),
    assets: join(base, 'assets'),
    libraries: join(base, 'libraries'),
    versions: join(base, 'versions'),
    java: join(base, 'java'),
    logs: join(base, 'logs'),
    temp: join(base, 'temp'),
  }
}

/** Reject path traversal in instance ids; instance ids double as directory names. */
export function sanitizeId(id: string): string {
  return id.replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_')
}

