/**
 * <ArchiveCore /> — the three-dimensional archive core.
 *
 * A frosted-glass cover over an amber light guide, brass ring grooves, an
 * optical puck, a champagne base plate with etched calibration lines and a
 * slow dust cloud inside the glass. Built from boxes, cylinders and tori only,
 * lit by a hand-authored PMREM studio (warm softbox, cool fill, amber bounce),
 * tone-mapped with ACES so highlights roll off instead of clipping.
 *
 * Behaviour:
 * - slow self-rotation with a breathing float; pointer parallax on the camera;
 * - `lifted` plays the "lift + straighten" move used when a file is selected;
 * - the renderer pauses when the page is hidden or the host is off screen;
 * - reduce-motion renders exactly one frame and never starts a loop;
 * - WebGL unavailability (or SSR) falls back to <ArchiveCoreLite />.
 *
 * three.js is imported dynamically so the module graph stays light for tests
 * and for browsers that never scroll to the core.
 */
import { useRef, useState } from 'react'
import { useOwnedEffect as useEffect } from '@/plugins/owned-effect.tsx'
import clsx from 'clsx'
import { ArchiveCoreLite } from './archive-core-lite.tsx'
import { damp, isBrowser, usePrefersReducedMotion } from './reduced-motion.ts'

type ThreeModule = typeof import('three')
type ThreeScene = InstanceType<ThreeModule['Scene']>
type ThreeVector = InstanceType<ThreeModule['Vector3']>
type ThreeMaterialLike = { dispose(): void }

const TAU = Math.PI * 2

export interface ArchiveCoreProps {
  className?: string
  /** Play the lift-and-straighten move (a file is selected or opening). */
  lifted?: boolean
  /** Stop rendering without unmounting. */
  paused?: boolean
  /** Skip WebGL entirely (tests, forced fallback). */
  forceLite?: boolean
  /** Accessible name; omit to mark the scene decorative. */
  label?: string
}

interface ArchiveSceneOptions {
  reduced: boolean
}

interface ArchiveSceneHandle {
  setLifted(value: boolean): void
  setPaused(value: boolean): void
  dispose(): void
}

/** Cheap WebGL probe — never throws, never leaks a context. */
export function supportsWebGL(): boolean {
  if (!isBrowser()) return false
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!context) return false
    const lose = (context as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* environment                                                         */
/* ------------------------------------------------------------------ */

/** A warm studio built from emissive boxes, turned into a PMREM cubemap. */
function createStudioEnvironment(THREE: ThreeModule): ThreeScene {
  const env = new THREE.Scene()
  const box = new THREE.BoxGeometry()
  box.deleteAttribute('uv')

  const shell = new THREE.Mesh(
    box,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.94, 0.92, 0.87), side: THREE.BackSide }),
  )
  shell.scale.set(26, 18, 26)
  shell.position.y = 5
  env.add(shell)

  const panel = (rgb: [number, number, number], size: [number, number, number], at: [number, number, number]) => {
    const mesh = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) }),
    )
    mesh.scale.set(size[0], size[1], size[2])
    mesh.position.set(at[0], at[1], at[2])
    env.add(mesh)
  }

  panel([2.55, 2.4, 2.05], [9.5, 0.24, 9.5], [0, 9.4, 0.4]) // warm ceiling softbox
  panel([1.35, 1.5, 1.85], [0.24, 6.4, 7.2], [-9.2, 4.4, 1.4]) // cool key fill
  panel([2.6, 1.85, 1.1], [0.24, 4.2, 6.2], [9.1, 3.6, -1.8]) // amber rim
  panel([0.95, 0.9, 0.84], [10, 0.24, 10], [0, -2.6, 0]) // warm floor bounce

  return env
}

/* ------------------------------------------------------------------ */
/* scene                                                               */
/* ------------------------------------------------------------------ */

function createArchiveScene(
  THREE: ThreeModule,
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  options: ArchiveSceneOptions,
): ArchiveSceneHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.86
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 80)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const studio = createStudioEnvironment(THREE)
  const envTarget = pmrem.fromScene(studio, 0.03)
  scene.environment = envTarget.texture
  scene.environmentIntensity = 0.42
  studio.traverse((object) => {
    const mesh = object as unknown as { geometry?: ThreeMaterialLike; material?: ThreeMaterialLike }
    mesh.geometry?.dispose()
    mesh.material?.dispose()
  })
  pmrem.dispose()

  const key = new THREE.DirectionalLight(0xfff1da, 1.5)
  key.position.set(-3.6, 5.4, 3.8)
  const rim = new THREE.DirectionalLight(0xd8c6a8, 0.42)
  rim.position.set(4.2, 2.6, -3.4)
  const hemi = new THREE.HemisphereLight(0xfff3e4, 0x4c4638, 0.2)
  scene.add(key, rim, hemi)

  // Draw-call budget: 1 shadow, 5 body parts, 4 amber guides, 2 brass grooves,
  // 1 cover, 2 edge sets, 1 etch set, 1 instanced screw set, 1 dust cloud =
  // 18 objects (well under the 40-call ceiling for this page).
  const trash: ThreeMaterialLike[] = []
  const track = <T extends ThreeMaterialLike>(item: T): T => {
    trash.push(item)
    return item
  }

  const world = new THREE.Group()
  scene.add(world)

  /* ---- base plate ------------------------------------------------- */
  const base = new THREE.Mesh(
    track(new THREE.BoxGeometry(3.08, 0.14, 1.9)),
    track(
      new THREE.MeshPhysicalMaterial({
        color: 0x9d8e73,
        roughness: 0.66,
        metalness: 0.12,
        clearcoat: 0.14,
        clearcoatRoughness: 0.6,
        envMapIntensity: 0.95,
      }),
    ),
  )
  base.position.y = 0.07
  world.add(base)

  const inset = new THREE.Mesh(
    track(new THREE.BoxGeometry(2.9, 0.024, 1.72)),
    track(new THREE.MeshStandardMaterial({ color: 0x7d7055, roughness: 0.86, metalness: 0.18 })),
  )
  inset.position.y = 0.148
  world.add(inset)

  /* ---- contact shadow --------------------------------------------- */
  const shadow = new THREE.Mesh(
    track(new THREE.CircleGeometry(1.95, 48)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0x2c261c,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    ),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = -0.001
  world.add(shadow)

  /* ---- optical core ----------------------------------------------- */
  const puck = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.34, 0.38, 0.18, 64)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0xb59a6a,
        roughness: 0.3,
        metalness: 0.46,
        envMapIntensity: 1.15,
      }),
    ),
  )
  puck.position.y = 0.26
  world.add(puck)

  const amber = track(
    new THREE.MeshStandardMaterial({
      color: 0xc98b3f,
      emissive: 0xc98b3f,
      emissiveIntensity: 1.35,
      roughness: 0.34,
      metalness: 0.08,
    }),
  )

  const guideRing = new THREE.Mesh(track(new THREE.TorusGeometry(0.4, 0.008, 8, 128)), amber)
  guideRing.rotation.x = Math.PI / 2
  guideRing.position.y = 0.3
  world.add(guideRing)

  // A rectangular light guide running just inside the glass walls.
  const bandGeometry = track(new THREE.BoxGeometry(1.5, 0.01, 0.02))
  for (const z of [-0.66, 0.66]) {
    const band = new THREE.Mesh(bandGeometry, amber)
    band.position.set(0, 0.3, z)
    world.add(band)
  }
  const sideGeometry = track(new THREE.BoxGeometry(0.02, 0.01, 1.34))
  for (const x of [-1.22, 1.22]) {
    const band = new THREE.Mesh(sideGeometry, amber)
    band.position.set(x, 0.3, 0)
    world.add(band)
  }

  /* ---- brass ring grooves ----------------------------------------- */
  const brass = track(
    new THREE.MeshStandardMaterial({
      color: 0x8d6b26,
      metalness: 0.95,
      roughness: 0.22,
      envMapIntensity: 1.25,
    }),
  )

  const grooveOuter = new THREE.Mesh(track(new THREE.TorusGeometry(0.62, 0.011, 8, 128)), brass)
  grooveOuter.rotation.x = Math.PI / 2
  grooveOuter.position.y = 0.19
  world.add(grooveOuter)

  const grooveInner = new THREE.Mesh(track(new THREE.TorusGeometry(0.82, 0.007, 6, 128)), brass)
  grooveInner.rotation.x = Math.PI / 2
  grooveInner.position.y = 0.192
  world.add(grooveInner)

  /* ---- inner cavity ----------------------------------------------- */
  const cavity = new THREE.Mesh(
    track(new THREE.BoxGeometry(2.6, 0.09, 1.42)),
    track(new THREE.MeshStandardMaterial({ color: 0x5a4f3c, roughness: 0.9, metalness: 0.1 })),
  )
  cavity.position.y = 0.205
  world.add(cavity)

  /* ---- frosted glass cover ---------------------------------------- */
  const cover = new THREE.Mesh(
    track(new THREE.BoxGeometry(2.94, 0.46, 1.76)),
    track(
      new THREE.MeshPhysicalMaterial({
        color: 0xe7dcc6,
        metalness: 0,
        roughness: 0.24,
        transmission: 1,
        thickness: 0.4,
        ior: 1.5,
        clearcoat: 0.14,
        clearcoatRoughness: 0.5,
        attenuationColor: new THREE.Color(0xdcc6a1),
        attenuationDistance: 3,
        envMapIntensity: 0.4,
        transparent: true,
      }),
    ),
  )
  cover.position.y = 0.36
  world.add(cover)

  // Technical hairlines: the cover and the base plate read as machined parts.
  const edgeMaterial = track(
    new THREE.LineBasicMaterial({ color: 0x3f382b, transparent: true, opacity: 0.3 }),
  )
  const coverEdges = new THREE.LineSegments(
    track(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.94, 0.46, 1.76), 30)),
    edgeMaterial,
  )
  coverEdges.position.y = 0.36
  world.add(coverEdges)

  const baseEdges = new THREE.LineSegments(
    track(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.08, 0.14, 1.9), 30)),
    edgeMaterial,
  )
  baseEdges.position.y = 0.07
  world.add(baseEdges)

  /* ---- etched calibration lines ----------------------------------- */
  const etched: ThreeVector[] = []
  const push = (x1: number, z1: number, x2: number, z2: number) => {
    etched.push(new THREE.Vector3(x1, 0.594, z1), new THREE.Vector3(x2, 0.594, z2))
  }
  push(-1.36, -0.78, 1.36, -0.78)
  push(-1.36, 0.78, 1.36, 0.78)
  push(-1.36, -0.78, -1.36, 0.78)
  push(1.36, -0.78, 1.36, 0.78)
  for (let i = 0; i < 9; i += 1) {
    const x = -1.3 + i * 0.325
    push(x, 0.62, x, 0.72)
    push(x, -0.72, x, -0.62)
  }
  push(-1.2, 0.42, -0.72, 0.42)
  push(0.66, 0.42, 1.2, 0.42)
  push(-1.2, -0.36, -0.48, -0.36)

  const etchedLines = new THREE.LineSegments(
    track(new THREE.BufferGeometry().setFromPoints(etched)),
    track(new THREE.LineBasicMaterial({ color: 0x6f6555, transparent: true, opacity: 0.42 })),
  )
  world.add(etchedLines)

  /* ---- screws ----------------------------------------------------- */
  const screws = new THREE.InstancedMesh(
    track(new THREE.CylinderGeometry(0.036, 0.036, 0.022, 14)),
    track(new THREE.MeshStandardMaterial({ color: 0x9d9484, metalness: 0.82, roughness: 0.38 })),
    4,
  )
  const matrix = new THREE.Matrix4()
  const screwPositions: [number, number][] = [
    [-1.38, -0.84],
    [1.38, -0.84],
    [-1.38, 0.84],
    [1.38, 0.84],
  ]
  screwPositions.forEach(([x, z], index) => {
    matrix.makeTranslation(x, 0.17, z)
    screws.setMatrixAt(index, matrix)
  })
  screws.instanceMatrix.needsUpdate = true
  world.add(screws)

  /* ---- dust motes inside the glass -------------------------------- */
  const dustCount = 90
  const positions = new Float32Array(dustCount * 3)
  for (let i = 0; i < dustCount; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 2.6
    positions[i * 3 + 1] = 0.18 + Math.random() * 0.42
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5
  }
  const dustGeometry = track(new THREE.BufferGeometry())
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const dust = new THREE.Points(
    dustGeometry,
    track(
      new THREE.PointsMaterial({
        color: 0xd8a15a,
        size: 0.014,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    ),
  )
  dust.position.y = 0.1
  world.add(dust)

  /* ---- framing ---------------------------------------------------- */
  const bounds = new THREE.Box3().setFromObject(world)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const target = center.clone()
  const homePosition = new THREE.Vector3()
  const direction = new THREE.Vector3(0.32, 0.52, 1).normalize()
  const offset = new THREE.Vector3()

  const applyFraming = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    const vFov = (camera.fov * Math.PI) / 180
    const fitHeight = (size.y * 2.3) / (2 * Math.tan(vFov / 2))
    const fitWidth = (size.x * 1.12) / (2 * Math.tan(vFov / 2) * camera.aspect)
    const distance = Math.max(fitHeight, fitWidth) * 1.16
    homePosition.copy(target).addScaledVector(direction, distance)
    camera.position.copy(homePosition)
    camera.lookAt(target)
  }

  /* ---- animation -------------------------------------------------- */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  const state = { time: 0, spin: 0.42, lift: 0, lifted: false }

  const update = (delta: number) => {
    state.time += delta
    state.lift = damp(state.lift, state.lifted ? 1 : 0, 3.1, delta)
    if (state.lifted) {
      state.spin = damp(state.spin, Math.round(state.spin / TAU) * TAU, 2.1, delta)
    } else {
      state.spin += delta * 0.13
    }
    pointer.x = damp(pointer.x, pointer.tx, 5, delta)
    pointer.y = damp(pointer.y, pointer.ty, 5, delta)

    world.rotation.y = state.spin + pointer.x * 0.16
    world.rotation.x = 0.03 - state.lift * 0.05 + Math.sin(state.time * 0.5) * 0.006
    world.position.y = state.lift * 0.4 + Math.sin(state.time * 0.68) * (0.013 + state.lift * 0.012)
    world.scale.setScalar(1 + Math.sin(state.time * 0.52) * 0.005)

    amber.emissiveIntensity = 1.3 + Math.sin(state.time * 1.7) * 0.28

    dust.rotation.y = state.time * 0.07
    dust.position.y = 0.1 + Math.sin(state.time * 0.42) * 0.03

    offset.set(pointer.x * camera.aspect * 0.34, pointer.y * 0.24, 0)
    camera.position.copy(homePosition).add(offset)
    camera.lookAt(target)
  }

  /* ---- loop ------------------------------------------------------- */
  let frameHandle = 0
  let running = false
  let paused = false
  let visible = true
  let disposed = false
  let last = 0

  const render = () => renderer.render(scene, camera)

  const tick = (now: number) => {
    frameHandle = 0
    if (disposed || paused) return
    const delta = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
    last = now
    update(delta)
    render()
    frameHandle = requestAnimationFrame(tick)
  }

  const start = () => {
    if (running || disposed || options.reduced || paused || !visible || document.hidden) return
    running = true
    last = performance.now()
    frameHandle = requestAnimationFrame(tick)
  }

  const stop = () => {
    running = false
    if (frameHandle) cancelAnimationFrame(frameHandle)
    frameHandle = 0
  }

  const onVisibility = () => {
    if (document.hidden) stop()
    else start()
  }

  const onPointerMove = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    pointer.tx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1))
    pointer.ty = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
  }

  applyFraming()
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          applyFraming()
          if (options.reduced) render()
        })
  resizeObserver?.observe(host)

  const intersectionObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            visible = entries[0]?.isIntersecting ?? true
            if (visible) start()
            else stop()
          },
          { threshold: 0.04 },
        )
  intersectionObserver?.observe(host)

  if (options.reduced) {
    update(0)
    render()
  } else {
    start()
  }

  return {
    setLifted(value: boolean) {
      state.lifted = value
      if (options.reduced) {
        state.lift = value ? 1 : 0
        update(0)
        render()
      }
    },
    setPaused(value: boolean) {
      paused = value
      if (paused) stop()
      else start()
    },
    dispose() {
      disposed = true
      stop()
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      for (const item of trash) {
        try {
          item.dispose()
        } catch {
          /* already gone */
        }
      }
      envTarget.dispose()
      renderer.dispose()
      try {
        renderer.forceContextLoss()
      } catch {
        /* context already lost */
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function ArchiveCore({ className, lifted = false, paused = false, forceLite = false, label }: ArchiveCoreProps) {
  const reduced = usePrefersReducedMotion()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<ArchiveSceneHandle | null>(null)
  const liftedRef = useRef(lifted)
  const pausedRef = useRef(paused)
  const [live, setLive] = useState(false)

  useEffect(() => {
    liftedRef.current = lifted
    handleRef.current?.setLifted(lifted)
  }, [lifted])

  useEffect(() => {
    pausedRef.current = paused
    handleRef.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    if (!isBrowser() || forceLite) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    if (!supportsWebGL()) return

    let cancelled = false
    let handle: ArchiveSceneHandle | null = null

    void (async () => {
      try {
        const THREE = await import('three')
        if (cancelled) return
        handle = createArchiveScene(THREE, canvas, host, { reduced })
        handleRef.current = handle
        handle.setLifted(liftedRef.current)
        handle.setPaused(pausedRef.current)
        setLive(true)
      } catch (error) {
        handle?.dispose()
        handle = null
        handleRef.current = null
        setLive(false)
        if (typeof console !== 'undefined') console.warn('[archive-core] WebGL scene unavailable', error)
      }
    })()

    return () => {
      cancelled = true
      handleRef.current = null
      handle?.dispose()
      handle = null
      setLive(false)
    }
  }, [forceLite, reduced])

  return (
    <div
      ref={hostRef}
      className={clsx('rh-core', live && 'is-live', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ArchiveCoreLite className="rh-core__lite" lifted={lifted} />
      <canvas ref={canvasRef} className="rh-core__canvas" />
      <span className="rh-core__rule rh-core__rule--top" aria-hidden="true" />
      <span className="rh-core__rule rh-core__rule--bottom" aria-hidden="true" />
    </div>
  )
}
