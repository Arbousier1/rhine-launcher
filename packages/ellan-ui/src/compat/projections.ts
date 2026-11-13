import type { Account, Instance, JavaRuntime, Settings } from '@rhine/core'

// Structural subsets of @xmcl/instance and xmcl-runtime-api's entity schemas.
// Keep the original runtime (and its Vue/service dependencies) out of Rhine's
// root TypeScript program. Empty strings/zero below are the original schemas'
// unknown/absent sentinels, not evidence of installation or authentication.
interface OriginalRuntimeVersions {
  minecraft: string
  forge: string
  fabricLoader: string
  quiltLoader: string
  neoForged: string
  optifine: string
  labyMod: string
}

interface OriginalInstance {
  path: string
  name: string
  author: string
  description: string
  version: string
  edition: 'java'
  runtime: OriginalRuntimeVersions
  java?: string
  resolution: { width: number; height: number; fullscreen: boolean }
  minMemory: number
  maxMemory: number
  assignMemory: true
  vmOptions: string[]
  mcOptions: string[]
  url: string
  icon: string
  fileApi: string
  server: null
  creationDate: number
  lastAccessDate: number
  lastPlayedDate: number
  playtime: number
}

/** Project requirements, not an installed/resolved original Version. */
export function toOriginalInstance(instance: Instance): OriginalInstance {
  const runtime: OriginalRuntimeVersions = {
    minecraft: instance.gameVersion, forge: '', fabricLoader: '', quiltLoader: '',
    neoForged: '', optifine: '', labyMod: '',
  }
  for (const loader of instance.loaders) {
    const version = loader.version ?? ''
    switch (loader.kind) {
      case 'forge': runtime.forge = version; break
      case 'fabric': runtime.fabricLoader = version; break
      case 'quilt': runtime.quiltLoader = version; break
      case 'neoforge': runtime.neoForged = version; break
      case 'optifine': runtime.optifine = version; break
      // Vanilla is represented by minecraft. The original schema has no
      // LiteLoader slot; do not relabel it as Forge, Fabric, or LabyMod.
    }
  }
  return {
    // This is the backend's canonical absolute path, never the local id or a
    // renderer/host-dependent path.resolve() guess.
    path: instance.path,
    name: instance.name,
    author: '',
    description: instance.notes ?? '',
    // Instance carries requirements, but no installed version id/verification.
    version: '',
    edition: 'java',
    runtime,
    java: instance.javaPath,
    resolution: { ...instance.window },
    minMemory: instance.memory.minMb,
    maxMemory: instance.memory.maxMb,
    assignMemory: true,
    vmOptions: [...instance.jvmArgs],
    mcOptions: [...instance.gameArgs],
    url: '',
    icon: instance.icon ?? '',
    fileApi: '',
    server: null,
    creationDate: instance.createdAt,
    // Core does not record original instance-selection/access history. Its
    // revision is config mtime, not lastAccessDate.
    lastAccessDate: 0,
    lastPlayedDate: instance.lastLaunchedAt ?? 0,
    // Both APIs measure accumulated playtime in milliseconds.
    playtime: instance.playTimeMs,
  }
}

interface OriginalGameProfile {
  id: string
  name: string
  textures: { SKIN: { url: string; metadata?: { model: string } } }
}

interface OriginalUser {
  id: string
  username: string
  authService: Account['kind']
  authority: string
  invalidated: boolean
  expiredAt: number
  profiles: Record<string, OriginalGameProfile>
  selectedProfile: string
  avatar?: string
}

/** Only the DTO's known selected profile; never tokens or invented entitlements. */
export function toOriginalUser(account: Account): OriginalUser {
  const profileId = account.uuid.replace(/-/g, '').toLowerCase()
  const authority = account.kind === 'offline' ? 'x://dev'
    : account.kind === 'microsoft' ? 'x://microsoft' : account.authServerUrl ?? ''
  const skin: OriginalGameProfile['textures']['SKIN'] = { url: '' }
  if (account.skinModel) skin.metadata = { model: account.skinModel === 'slim' ? 'slim' : 'steve' }
  return {
    id: account.id,
    // Core has the game name, not an email/login username.
    username: account.name,
    authService: account.kind,
    authority,
    // A public DTO is token-redacted; token absence is not invalidation proof.
    // Missing custom authority is unusable, rather than a Microsoft fallback.
    invalidated: !authority,
    // Offline identities have no credential expiry. Use a finite JSON-safe
    // non-expiring sentinel; online unknown expiry stays the original -1.
    expiredAt: account.expiresAt ?? (account.kind === 'offline' ? Number.MAX_SAFE_INTEGER : -1),
    profiles: { [profileId]: { id: profileId, name: account.name, textures: { SKIN: skin } } },
    selectedProfile: profileId,
    // An avatar is not a full skin texture; keep SKIN.url unknown. No uploadable
    // skin/cape capabilities can be inferred from this DTO.
    avatar: account.avatar,
  }
}

interface OriginalJava {
  path: string
  version: string
  majorVersion: number
  arch: JavaRuntime['arch']
  valid: boolean
}

/** JavaRuntime also includes cached/unprobed records; validity needs evidence. */
export function toOriginalJava(java: JavaRuntime, valid = false): OriginalJava {
  return { path: java.path, version: java.version, majorVersion: java.majorVersion, arch: java.arch, valid }
}

interface OriginalSettingsDefaults {
  databaseReady: boolean
  online: boolean
  apiSets?: { name: string; url: string }[]
}
interface OriginalReadiness {
  databaseReady: boolean
  /** Supply only when connectivity is actually known. */
  online?: boolean
}
interface SettingsOverlay {
  locale: Settings['language']
  theme: 'dark' | 'light'
  apiSetsPreference: 'mojang' | 'bmcl' | ''
  maxSockets: number
  httpProxy: string
  httpProxyEnabled: boolean
  databaseReady: boolean
  online: boolean
}

/** Overlay common fields onto the caller's serialized original Settings defaults. */
export function toOriginalSettings<T extends OriginalSettingsDefaults>(
  settings: Settings,
  originalDefaults: T,
  readiness: OriginalReadiness,
): Omit<T, keyof SettingsOverlay> & SettingsOverlay {
  const defaults = structuredClone(originalDefaults)
  const proxy = settings.proxy
  const host = proxy?.host ?? ''
  const proxyHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const mirrorRoot = settings.mirrors.launcherMeta.replace(/\/+$/, '')
  const knownBmcl = defaults.apiSets?.some(set => set.name === 'bmcl' && set.url.replace(/\/+$/, '') === mirrorRoot)
  return {
    ...defaults,
    locale: settings.language,
    theme: settings.theme === 'light' ? 'light' : 'dark',
    // Only name BMCL when the actual endpoint matches the supplied original
    // entry. Independent/custom provider URLs have no single original apiSets
    // equivalent; keep the list and use no named preference instead of lying
    // that an arbitrary mirror is BMCL or fabricating a family of URLs.
    apiSetsPreference: settings.downloadSource === 'official' ? 'mojang' : knownBmcl ? 'bmcl' : '',
    maxSockets: settings.concurrency,
    // Do not expose proxy passwords/credentials in the shared renderer state.
    httpProxy: host ? `http://${proxyHost}:${proxy!.port}` : '',
    httpProxyEnabled: proxy?.enabled ?? false,
    databaseReady: readiness.databaseReady,
    online: readiness.online ?? defaults.online,
    // In particular, showSnapshots != launcher allowPrerelease, and
    // autoDownloadJava != launcher autoDownload. Unsupported fields, including
    // update readiness and maxAPISockets, remain the actual original defaults.
  }
}
