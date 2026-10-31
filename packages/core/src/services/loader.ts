/**
 * Pure loader repository facade.
 *
 * This module deliberately does NOT extend Cordis Service and never registers
 * itself on a context: every public action is owned by one single-capability
 * feature plugin under plugins/features/loaders/. The facade only exists so the
 * generated compatibility projections and legacy algorithm tests can dispatch a
 * LoaderKind to the matching adapter without duplicating protocol code.
 */
import type { LoaderKind, LoaderSpec, LoaderVersion } from '../types.ts'
import type { LoaderHost } from '../loader/capabilities.ts'
import { errorMessage } from '../loader/http.ts'
import {
  listFabricVersions, listForgeVersions, listNeoForgeVersions, listOptiFineVersions, listQuiltVersions,
} from '../loader/list.ts'
import { installProfileVersion } from '../loader/profile-install.ts'
import { installWithInstaller } from '../loader/installer.ts'
import { installOptiFine } from '../loader/optifine-install.ts'
import { detectLoaderAttachments, readInstalledVersions } from '../loader/versions.ts'
import { loaderJavaMajor } from '../loader/runtime.ts'
import {
  fabricProfileUrls, fabricVersionId, normalizeFabricProfile,
} from '../loader/fabric.ts'
import {
  normalizeQuiltProfile, quiltProfileUrls, quiltVersionId,
} from '../loader/quilt.ts'
import { forgeInstallerUrls, forgeVersionId } from '../loader/forge.ts'
import { neoforgeInstallerUrls, neoforgeVersionId } from '../loader/neoforge.ts'


/** One loader protocol adapter. */
export interface LoaderAdapter {
  /** List available builds, newest first. */
  versions(host: LoaderHost, gameVersion: string): Promise<LoaderVersion[]>
  /** Install one build and return the generated version id. */
  install(host: LoaderHost, gameVersion: string, loaderVersion: string): Promise<string>
  /** Java feature version the installer/patcher needs. */
  javaMajor(gameVersion: string): number
}

/** Adapter registry; there is intentionally no switch (kind) anywhere else. */
export const LOADER_ADAPTERS: Partial<Record<LoaderKind, LoaderAdapter>> = {
  fabric: {
    javaMajor: () => 8,
    versions: listFabricVersions,
    install(host, gameVersion, loaderVersion) {
      return installProfileVersion(host, {
        id: fabricVersionId(gameVersion, loaderVersion),
        label: 'Fabric',
        profileUrls: fabricProfileUrls(gameVersion, loaderVersion),
        normalize: (payload) => normalizeFabricProfile(payload, gameVersion, loaderVersion),
      })
    },
  },
  quilt: {
    javaMajor: () => 8,
    versions: listQuiltVersions,
    install(host, gameVersion, loaderVersion) {
      return installProfileVersion(host, {
        id: quiltVersionId(gameVersion, loaderVersion),
        label: 'Quilt',
        profileUrls: quiltProfileUrls(gameVersion, loaderVersion),
        normalize: (payload) => normalizeQuiltProfile(payload, gameVersion, loaderVersion),
      })
    },
  },
  forge: {
    javaMajor: (gameVersion) => loaderJavaMajor('forge', gameVersion),
    versions: listForgeVersions,
    install(host, gameVersion, loaderVersion) {
      return installWithInstaller(host, {
        kind: 'forge',
        gameVersion,
        loaderVersion,
        label: 'Forge',
        installerUrls: forgeInstallerUrls(gameVersion, loaderVersion),
        expectedVersionId: forgeVersionId(gameVersion, loaderVersion),
        javaMajor: loaderJavaMajor('forge', gameVersion),
      })
    },
  },
  neoforge: {
    javaMajor: (gameVersion) => loaderJavaMajor('neoforge', gameVersion),
    versions: listNeoForgeVersions,
    install(host, gameVersion, loaderVersion) {
      return installWithInstaller(host, {
        kind: 'neoforge',
        gameVersion,
        loaderVersion,
        label: 'NeoForge',
        installerUrls: neoforgeInstallerUrls(gameVersion, loaderVersion),
        expectedVersionId: neoforgeVersionId(gameVersion, loaderVersion),
        javaMajor: loaderJavaMajor('neoforge', gameVersion),
      })
    },
  },
  optifine: {
    javaMajor: (gameVersion) => loaderJavaMajor('optifine', gameVersion),
    versions: listOptiFineVersions,
    install(host, gameVersion, loaderVersion) {
      return installOptiFine(host, { gameVersion, loaderVersion, label: 'OptiFine' })
    },
  },
}

/**
 * Legacy pure repository.
 *
 * @deprecated Public loader actions live in plugins/features/loaders/*.plugin.ts;
 *   this class is only a typed convenience wrapper used by compatibility
 *   projections and the loader algorithm tests.
 */
export class LoaderService {
  constructor(private readonly host: LoaderHost) {}

  /** Available loader builds, newest first. */
  versions(kind: LoaderKind, gameVersion: string): Promise<LoaderVersion[]> {
    const adapter = adapterOf(kind)
    return adapter.versions(this.host, requireVersion(gameVersion, '游戏版本'))
  }

  /** Install one loader build and return the generated version id. */
  install(kind: LoaderKind, gameVersion: string, loaderVersion: string): Promise<string> {
    const adapter = adapterOf(kind)
    const game = requireVersion(gameVersion, '游戏版本')
    const loader = requireVersion(loaderVersion, '加载器版本')
    return adapter.install(this.host, game, loader)
  }

  /** Loader attachments installed for a game version. */
  async detect(gameVersion: string): Promise<LoaderSpec[]> {
    const game = requireVersion(gameVersion, '游戏版本')
    const versions = await readInstalledVersions(this.host.paths().versions)
    return detectLoaderAttachments(versions, game)
  }
}

/** Alias kept for callers that prefer the repository name. */
export { LoaderService as LoaderRepository }

/**
 * @deprecated Tombstone only: loader actions are single-capability feature
 * descriptors under plugins/features/loaders/. No service/plugin is registered
 * here; core/index.ts and the server boot must drop this export.
 */
export const loaderPlugin = undefined

function adapterOf(kind: LoaderKind): LoaderAdapter {
  const adapter = LOADER_ADAPTERS[kind]
  if (!adapter) throw new Error('暂不支持 ' + kind + ' 加载器')
  return adapter
}

function requireVersion(value: string, label: string): string {
  const text = (value ?? '').trim()
  if (!text) throw new Error(label + '不能为空')
  return text
}

/** Re-exported for diagnostics in tests/callers that only import this module. */
export { errorMessage }