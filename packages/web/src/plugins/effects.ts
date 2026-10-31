/**
 * Thin bridges from page code to optional motion features.
 *
 * A page must not import an animation implementation. When it needs to record
 * something for one (the card → detail FLIP), it calls this adapter, which
 * checks the registry first and silently does nothing when the feature is off.
 */
import { rememberFlip, snapshotRect } from '@/motion'
import { webPlugins } from './registry.ts'

/** Remember the clicked card box for the card-expand FLIP, if that motion is on. */
export function captureCardOpen(element: Element | null, label?: string): void {
  if (!element) return
  if (!webPlugins.has('motion.card-expand')) return
  try {
    rememberFlip(snapshotRect(element), label)
  } catch {
    /* measurement can fail in exotic embeddings; navigation still works */
  }
}
