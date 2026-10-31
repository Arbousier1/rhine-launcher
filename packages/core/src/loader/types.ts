/**
 * Shared structural types for version json files read from disk.
 *
 * The loader keeps its detection code independent from the full contract type
 * because a corrupted third-party version json may omit almost every field; the
 * classifiers only look at id, mainClass and library names.
 */
import type { LoaderKind } from '../types.ts'

/** Minimal version json view used by detection. */
export interface LoadedVersionJson {
  id?: string
  inheritsFrom?: string
  mainClass?: string
  libraries?: { name?: string }[]
  arguments?: unknown
  [key: string]: unknown
}

/** One loader attachment found in an installed version json. */
export interface LoaderAttachment {
  kind: LoaderKind
  version?: string
}
