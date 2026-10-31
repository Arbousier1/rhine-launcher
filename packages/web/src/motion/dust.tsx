/**
 * <Dust /> — the barely-there dust motes that keep the archive from feeling
 * like a static screenshot.
 *
 * 20–40 one-pixel specks, deterministic per seed so server markup and client
 * markup agree. Pure CSS animation (transform/opacity only) and removed
 * entirely for reduce-motion users.
 */
import { useMemo } from 'react'
import clsx from 'clsx'
import type { CSSProperties } from 'react'

export interface DustProps {
  /** Number of specks (20–40 keeps the page at 60fps). */
  count?: number
  seed?: number
  className?: string
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Speck {
  left: number
  top: number
  size: number
  duration: number
  delay: number
  dx: number
  dy: number
  opacity: number
}

export function Dust({ count = 30, seed = 7, className }: DustProps) {
  const specks = useMemo<Speck[]>(() => {
    const random = mulberry32(seed * 2654435761)
    const total = Math.max(0, Math.min(80, count))
    return Array.from({ length: total }, () => ({
      left: random() * 100,
      top: random() * 100,
      size: random() > 0.82 ? 2 : 1,
      duration: 18 + random() * 18,
      delay: -random() * 30,
      dx: (random() - 0.5) * 26,
      dy: -10 - random() * 26,
      opacity: 0.24 + random() * 0.34,
    }))
  }, [count, seed])

  return (
    <span className={clsx('rh-dust', className)} aria-hidden="true">
      {specks.map((speck, index) => (
        <i
          key={index}
          className="rh-dust__mote"
          style={
            {
              left: speck.left + '%',
              top: speck.top + '%',
              width: speck.size,
              height: speck.size,
              animationDuration: speck.duration + 's',
              animationDelay: speck.delay + 's',
              '--rh-dx': speck.dx.toFixed(1) + 'px',
              '--rh-dy': speck.dy.toFixed(1) + 'px',
              '--rh-dust-opacity': speck.opacity.toFixed(2),
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}
