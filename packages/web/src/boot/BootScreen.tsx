/**
 * Boot sequence (a settled feature of its own: motion.boot).
 *
 * Two states:
 * - `playing`: the 1.96s archive boot — ink field, hairline scanner, brand
 *   characters decrypting out of noise, then a white field flash.
 * - `quiet`: the paper-coloured connecting / offline card used while the first
 *   bootstrap is still in flight (or after the sequence already played).
 *
 * The overlay is purely additive: the shell renders underneath from the first
 * frame, so disabling this feature can never leave a blank window. When the
 * boot hands over to the shell it drops a paper curtain that fades out, which
 * is the "white field → interface" part of the sequence.
 */
import { useCallback, useRef, useState } from 'react'
import { useOwnedEffect as useEffect } from '@/plugins/owned-effect.tsx'
import { Button, Spinner } from '@/ui'
import { RhineMark } from '@/ui/icons'
import type { Translator } from '@/app/i18n'
import { isBrowser, prefersReducedMotion } from '@/motion/reduced-motion.ts'
import { scrambleFrame } from '@/motion/scramble.ts'
import { BOOT_DURATION_MS, bootFrameAt, hasBootPlayed, markBootPlayed } from './boot-sequence.ts'
import type { BootFrame } from './boot-sequence.ts'

export interface BootScreenProps {
  t: Translator
  error: string | null
  onRetry: () => void
  /** True while a retry is in flight. */
  busy?: boolean
  /** The shell has real data; the boot may hand over. */
  ready: boolean
}

type BootMode = 'playing' | 'quiet' | 'done'

const CURTAIN_MS = 660

function initialMode(): BootMode {
  if (!isBrowser()) return 'quiet'
  if (prefersReducedMotion()) return 'quiet'
  if (hasBootPlayed()) return 'quiet'
  return 'playing'
}

export function BootScreen({ t, error, onRetry, busy, ready }: BootScreenProps) {
  const [mode, setMode] = useState<BootMode>(initialMode)
  const [frame, setFrame] = useState<BootFrame>(() => bootFrameAt(0))
  const [curtain, setCurtain] = useState(false)
  const readyRef = useRef(ready)
  const finishedRef = useRef(false)

  useEffect(() => {
    readyRef.current = ready
  }, [ready])

  const finishSequence = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    markBootPlayed()
    setMode((current) => {
      if (current !== 'playing') return current
      return readyRef.current ? 'done' : 'quiet'
    })
  }, [])

  // One rAF driver for the whole sequence.
  useEffect(() => {
    if (mode !== 'playing') return
    let raf = 0
    let started = 0
    let lastFrame = 0
    let done = false

    const advance = (elapsed: number) => {
      if (elapsed >= BOOT_DURATION_MS) {
        setFrame(bootFrameAt(BOOT_DURATION_MS))
        done = true
        finishSequence()
        return
      }
      setFrame(bootFrameAt(elapsed))
    }

    const tick = (now: number) => {
      if (done) return
      if (!started) started = now
      lastFrame = now
      advance(now - started)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    // Fallback for environments that stop delivering frames (hidden tab, a
    // stalled compositor): step the timeline on a timer so the boot always ends.
    const timer = window.setInterval(() => {
      if (done) return
      const now = performance.now()
      if (now - lastFrame < 140) return
      if (!started) started = now
      advance(now - started)
    }, 60)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(timer)
    }
  }, [mode, finishSequence])

  // The offline card is more important than the theatre.
  useEffect(() => {
    if (error) finishSequence()
  }, [error, finishSequence])

  // Hand over as soon as the shell has data.
  useEffect(() => {
    if (mode !== 'quiet' || !ready) return
    markBootPlayed()
    setMode('done')
  }, [mode, ready])

  // Paper curtain between the flash and the interface.
  useEffect(() => {
    if (mode !== 'done') return
    setCurtain(true)
    const timer = window.setTimeout(() => setCurtain(false), CURTAIN_MS)
    return () => window.clearTimeout(timer)
  }, [mode])

  const skip = useCallback(() => {
    if (mode !== 'playing') return
    setFrame(bootFrameAt(BOOT_DURATION_MS))
    finishSequence()
  }, [mode, finishSequence])

  // Keyboard skip, matching the click affordance.
  useEffect(() => {
    if (mode !== 'playing') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, skip])

  // Backstop: a stalled frame pipeline still has to leave the boot screen.
  useEffect(() => {
    if (mode !== 'playing') return
    const timer = window.setTimeout(() => {
      setFrame(bootFrameAt(BOOT_DURATION_MS))
      finishSequence()
    }, BOOT_DURATION_MS + 420)
    return () => window.clearTimeout(timer)
  }, [mode, finishSequence])

  if (mode === 'done') {
    return curtain ? <div className="rh-curtain" aria-hidden="true" /> : null
  }

  if (mode === 'playing') {
    const scanTop = -6 + frame.scan * 112
    const brand = {
      opacity: frame.brand,
      transform: 'translate3d(0, ' + (1 - frame.brand) * 6 + 'px, 0)',
    }
    return (
      <div
        className="rh-boot2"
        role="status"
        aria-live="polite"
        aria-label={t('app.name') + ' · ' + t('boot.connecting')}
        onPointerDown={skip}
      >
        <span className="rh-boot2__grid" aria-hidden="true" />
        <span
          className="rh-boot2__scan"
          aria-hidden="true"
          style={{
            transform: 'translate3d(0, ' + scanTop + 'vh, 0)',
            opacity: frame.phase === 'scan' ? 0.9 : 0,
            transition: 'opacity 120ms linear',
          }}
        />

        <div className="rh-boot2__brand" aria-hidden="true" style={brand}>
          <span className="rh-boot2__line">{scrambleFrame('RHINE', frame.reveal, 3)}</span>
          <span className="rh-boot2__line rh-boot2__line--sub">
            {scrambleFrame('LAUNCHER', frame.reveal, 7)}
          </span>
          <span className="rh-caption rh-boot2__caption">
            {scrambleFrame('ARCHIVE SYSTEM', frame.reveal, 11)}
          </span>
          <span className="rh-boot2__rule">
            <span className="rh-boot2__rulefill" style={{ transform: 'scaleX(' + frame.rule + ')' }} />
          </span>
        </div>

        <div className="rh-boot2__meta rh-boot2__meta--top" aria-hidden="true">
          <span>RHINE LABORATORY</span>
          <span>ARCHIVE TERMINAL</span>
        </div>
        <div className="rh-boot2__meta rh-boot2__meta--bottom" aria-hidden="true">
          <span>{'SECURITY // ' + frame.phase.toUpperCase()}</span>
          <span className="rh-boot2__skip">点击跳过 / SKIP</span>
        </div>

        <span className="rh-boot2__field" aria-hidden="true" style={{ opacity: frame.flash }} />
      </div>
    )
  }

  return (
    <div className="rh-boot" role="status" aria-live="polite">
      <div className="rh-boot__inner">
        <RhineMark className="rh-boot__mark" />
        <span className="rh-boot__title">{t('app.name')}</span>
        {error ? (
          <>
            <span className="rh-caption" style={{ color: 'var(--rhine-danger)' }}>
              OFFLINE
            </span>
            <p className="rh-boot__hint">{t('error.offline.desc')}</p>
            <p className="rh-boot__hint" style={{ color: 'var(--rhine-muted)' }}>
              {error}
            </p>
            <div className="rh-boot__actions">
              <Button variant="primary" size="sm" onClick={onRetry} loading={busy}>
                {t('common.retry')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="rh-boot__hint">{t('boot.connecting')}</p>
            <div className="rh-boot__bar">
              <div className="rh-boot__scan" />
            </div>
            <p className="rh-boot__hint" style={{ fontSize: 12, opacity: 0.7 }}>
              {t('boot.hint')}
            </p>
            <Spinner size="sm" label={t('common.loading')} />
          </>
        )}
      </div>
    </div>
  )
}
