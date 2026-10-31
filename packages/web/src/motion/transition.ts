/**
 * Cross-view transitions: the card → detail FLIP and the clip-path "expansion"
 * that opens a detail page out of the card the user clicked.
 *
 * Both are best-effort browser effects: every entry point is guarded so a
 * server render, an old browser without the Web Animations API or a stale
 * snapshot simply falls through to the plain navigation.
 */
import { useEffect } from 'react'
import type { RefObject } from 'react'
import { isBrowser, prefersReducedMotion } from './reduced-motion.ts'

export interface RectSnapshot {
  left: number
  top: number
  width: number
  height: number
}

/** How long a recorded card rectangle stays valid. */
const FLIP_TTL_MS = 2200
const FLIP_DURATION_MS = 340
const EXPAND_DURATION_MS = 360

let pending: { rect: RectSnapshot; label: string; at: number } | null = null

/** Snapshot an element's viewport rectangle. */
export function snapshotRect(element: Element): RectSnapshot {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** Remember the card the user is leaving so the detail page can grow out of it. */
export function rememberFlip(rect: RectSnapshot, label = ''): void {
  if (!isBrowser()) return
  if (rect.width <= 0 || rect.height <= 0) return
  pending = { rect, label, at: Date.now() }
}

/** Consume the remembered rectangle (one shot, expires quickly). */
export function takeFlip(): { rect: RectSnapshot; label: string } | null {
  const item = pending
  pending = null
  if (!item) return null
  if (Date.now() - item.at > FLIP_TTL_MS) return null
  return { rect: item.rect, label: item.label }
}

/** Exposed for tests / hot reload. */
export function clearFlip(): void {
  pending = null
}

function supportsAnimate(element: Element): element is Element & { animate: Element['animate'] } {
  return typeof (element as { animate?: unknown }).animate === 'function'
}

/**
 * FLIP ghost: a hairline rectangle that flies from the card position to the
 * destination element (the detail glyph) while it shrinks and fades.
 */
export function playFlipGhost(origin: RectSnapshot, target: Element): void {
  if (!isBrowser() || prefersReducedMotion()) return
  if (!document.body || !supportsAnimate(target)) return
  const box = target.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return

  const ghost = document.createElement('div')
  ghost.className = 'rh-flip-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.left = origin.left + 'px'
  ghost.style.top = origin.top + 'px'
  ghost.style.width = origin.width + 'px'
  ghost.style.height = origin.height + 'px'
  document.body.appendChild(ghost)

  const dx = box.left - origin.left
  const dy = box.top - origin.top
  const sx = Math.max(0.02, box.width / origin.width)
  const sy = Math.max(0.02, box.height / origin.height)

  let animation: Animation | null = null
  try {
    animation = ghost.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1, 1)', opacity: 0.85 },
        {
          transform: 'translate3d(' + dx + 'px, ' + dy + 'px, 0) scale(' + sx + ', ' + sy + ')',
          opacity: 0,
        },
      ],
      { duration: FLIP_DURATION_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
    )
  } catch {
    ghost.remove()
    return
  }
  const remove = () => ghost.remove()
  animation.onfinish = remove
  animation.oncancel = remove
  window.setTimeout(remove, FLIP_DURATION_MS + 240)
}

/**
 * Animate a container from the card rectangle to its own full box with
 * `clip-path`, so the detail page looks like it unfolds out of the card.
 * Returns a cleanup that removes the animation classes.
 */
export function expandFromRect(root: HTMLElement, origin: RectSnapshot): () => void {
  if (!isBrowser() || prefersReducedMotion()) return () => undefined
  const box = root.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return () => undefined
  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max))
  const top = clamp(origin.top - box.top, box.height)
  const left = clamp(origin.left - box.left, box.width)
  const right = clamp(box.right - (origin.left + origin.width), box.width)
  const bottom = clamp(box.bottom - (origin.top + origin.height), box.height)
  root.style.setProperty('--rh-ex-top', top.toFixed(1) + 'px')
  root.style.setProperty('--rh-ex-right', right.toFixed(1) + 'px')
  root.style.setProperty('--rh-ex-bottom', bottom.toFixed(1) + 'px')
  root.style.setProperty('--rh-ex-left', left.toFixed(1) + 'px')
  root.classList.add('is-card-expand')
  const timer = window.setTimeout(() => {
    root.classList.remove('is-card-expand')
    root.style.removeProperty('--rh-ex-top')
    root.style.removeProperty('--rh-ex-right')
    root.style.removeProperty('--rh-ex-bottom')
    root.style.removeProperty('--rh-ex-left')
  }, EXPAND_DURATION_MS)
  return () => {
    window.clearTimeout(timer)
    root.classList.remove('is-card-expand')
  }
}

/**
 * Detail-page glue: on mount, replay the remembered card rectangle as a
 * clip-path expansion and send the ghost to `[data-flip-target]`.
 */
export function useCardExpand(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const remembered = takeFlip()
    if (!remembered) return
    const cleanup = expandFromRect(root, remembered.rect)
    const target = root.querySelector('[data-flip-target]')
    if (target) playFlipGhost(remembered.rect, target)
    return cleanup
  }, [rootRef])
}