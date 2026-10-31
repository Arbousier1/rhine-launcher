/**
 * Java requirements of the loaders.
 *
 * Installing a loader runs its own tooling (installer, processors, patcher).
 * These helpers derive the Java feature version that tooling needs; the launcher
 * then asks the java.pick capability for the closest installed runtime.
 */

/** Split a Minecraft version into numeric parts. */
export function gameVersionParts(gameVersion: string): [number, number, number] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec((gameVersion ?? '').trim())
  if (!match) return [0, 0, 0]
  return [Number(match[1]) || 0, Number(match[2]) || 0, Number(match[3]) || 0]
}

/** True when the game version uses the modern calendar scheme (26.x). */
export function isCalendarVersion(gameVersion: string): boolean {
  return gameVersionParts(gameVersion)[0] > 1
}

/**
 * Minimum Java feature version for Minecraft itself.
 *
 * Minecraft 1.20.5+ and every 26.x build need Java 21, 1.18-1.20.4 need 17,
 * 1.17 needs 16 and older versions run on 8.
 */
export function requiredJavaMajor(gameVersion: string): number {
  const [major, minor, patch] = gameVersionParts(gameVersion)
  if (major > 1) return 21
  if (major !== 1) return 8
  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 18) return 17
  if (minor >= 17) return 16
  return 8
}

/**
 * Java version needed by a loader installer/patcher.
 *
 * Mod loaders target the same JVM as the game they patch; the returned value is
 * fed to java.pick, which upgrades to a higher installed runtime when needed.
 */
export function loaderJavaMajor(kind: 'forge' | 'neoforge' | 'optifine' | 'fabric' | 'quilt', gameVersion: string): number {
  if (kind === 'fabric' || kind === 'quilt') return 8
  return requiredJavaMajor(gameVersion)
}

/** Java 8/16 names used in menu labels for very old versions. */
export function javaMenuLabel(major: number): string {
  return major <= 8 ? 'Java 8' : 'Java ' + major
}
