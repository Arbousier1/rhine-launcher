/**
 * <ArchiveArray /> — the three-dimensional archive rack.
 *
 * Instances are glass slabs resting in a shallow tray: columns run left→right,
 * rows run front→back. Hovering lifts a slab, clicking selects it, clicking the
 * selected slab pulls it out of the rack while the camera eases in. Labels are
 * painted per slab onto a canvas texture (version first, then the archive name),
 * so the rack reads like physical media rather than a web list.
 *
 * Honest fallbacks: SSR, no WebGL, or reduce-motion never leave a blank stage —
 * the lite grid is fully interactive, and reduce-motion still renders frames,
 * it merely snaps instead of easing.
 */
import { useRef, useState } from 'react'
import { useOwnedEffect as useEffect } from '@/plugins/owned-effect.tsx'
import clsx from 'clsx'
import { arrayBounds, arrayLayout } from './archive-array-layout.ts'
import type { ArraySlot } from './archive-array-layout.ts'
import { isBrowser, usePrefersReducedMotion } from './reduced-motion.ts'
import { supportsWebGL } from './archive-core.tsx'

type ThreeModule = typeof import('three')
type ThreeGroup = InstanceType<ThreeModule['Group']>
type ThreeMesh = InstanceType<ThreeModule['Mesh']>
type ThreeTexture = InstanceType<ThreeModule['Texture']>
type ThreeMaterial = InstanceType<ThreeModule['Material']>

export interface ArchiveArrayItem {
  id: string
  /** Archive number, e.g. "X-004". */
  number: string
  /** Instance name shown under the version. */
  name: string
  /** Minecraft version, the primary label. */
  version: string
  /** Loader summary, e.g. "FABRIC 0.20.1" or "原版". */
  loader: string
  running: boolean
}

export interface ArchiveArrayProps {
  items: readonly ArchiveArrayItem[]
  selectedId: string | null
  /** The slab currently pulled out of the rack (dossier open). */
  pulledId: string | null
  onSelect: (id: string) => void
  /** Pull the selected slab out; the page opens the dossier. */
  onPull: (id: string) => void
  className?: string
  label?: string
}

interface SceneState {
  items: readonly ArchiveArrayItem[]
  selected: number
  pulled: number
  hovered: number
  reduced: boolean
}

interface SceneHandle {
  setState(next: Pick<SceneState, 'items' | 'selected' | 'pulled'>): void
  dispose(): void
}

/* ------------------------------------------------------------------ */
/* label texture                                                       */
/* ------------------------------------------------------------------ */

function paintLabel(
  THREE: ThreeModule,
  item: ArchiveArrayItem,
  selected: boolean,
): ThreeTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = selected ? '#c98b3f' : '#8b8579'
    ctx.font = '600 34px "MiSans", "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(item.number, 26, 64)

    ctx.fillStyle = item.running ? '#b0712a' : '#171713'
    ctx.font = '700 104px "MiSans", "PingFang SC", "Microsoft YaHei", sans-serif'
    const version = item.version || '未安装'
    ctx.fillText(version.length > 10 ? version.slice(0, 10) + '…' : version, 24, 186)

    ctx.fillStyle = '#4a463c'
    ctx.font = '400 38px "MiSans", "PingFang SC", "Microsoft YaHei", sans-serif'
    const name = item.name.length > 12 ? item.name.slice(0, 12) + '…' : item.name
    ctx.fillText(name, 26, 246)

    ctx.fillStyle = '#8b8579'
    ctx.font = '500 26px "MiSans", "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(item.loader.toUpperCase(), 26, 292)

    ctx.strokeStyle = 'rgba(23,23,19,0.18)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(26, 84)
    ctx.lineTo(canvas.width - 26, 84)
    ctx.stroke()
    if (item.running) {
      ctx.fillStyle = '#c98b3f'
      ctx.beginPath()
      ctx.arc(canvas.width - 44, 52, 10, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/* ------------------------------------------------------------------ */
/* scene                                                               */
/* ------------------------------------------------------------------ */

const SLAB_W = 2.5
const SLAB_D = 1.55
const SLAB_H = 0.16
const LIFT_SELECTED = 0.34
const LIFT_HOVER = 0.16
const LIFT_PULLED = 2.55

interface Slab {
  group: ThreeGroup
  slot: ArraySlot
  pick: ThreeMesh
  glow: ThreeMesh
  label: ThreeMesh
  labelTexture: ThreeTexture | null
  currentY: number
  targetY: number
  currentGlow: number
  targetGlow: number
}

function createScene(
  THREE: ThreeModule,
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  initial: SceneState,
  callbacks: { select: (index: number) => void; pull: (index: number) => void },
): SceneHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.98
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 90)
  const state: SceneState = { ...initial }

  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8b8578, 0.85))
  const key = new THREE.DirectionalLight(0xfff1da, 1.65)
  key.position.set(-4.4, 8.2, 5.4)
  const rim = new THREE.DirectionalLight(0xdcc7a4, 0.5)
  rim.position.set(5.2, 3.2, -4.4)
  scene.add(key, rim, new THREE.AmbientLight(0xfff4e6, 0.24))

  const trash: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(item: T): T => {
    trash.push(item)
    return item
  }

  const cameraTarget = new THREE.Vector3(0, 0.2, 0)
  const cameraGoal = new THREE.Vector3(0, 0.2, 0)
  let yaw = -0.34
  let pitch = 0.62
  let radius = 9
  let yawGoal = -0.34
  let pitchGoal = 0.62
  let radiusGoal = 9

  const world = new THREE.Group()
  scene.add(world)

  /* ---- tray -------------------------------------------------------- */
  const tray = new THREE.Group()
  world.add(tray)
  const plate = new THREE.Mesh(
    track(new THREE.BoxGeometry(1, 1, 1)),
    track(new THREE.MeshPhysicalMaterial({
      color: 0xe7e1d5,
      roughness: 0.82,
      metalness: 0.05,
      clearcoat: 0.12,
      clearcoatRoughness: 0.7,
    })),
  )
  tray.add(plate)
  const groove = new THREE.Mesh(
    track(new THREE.BoxGeometry(1, 1, 1)),
    track(new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.95, metalness: 0 })),
  )
  groove.position.y = 0.055
  tray.add(groove)

  const railMaterial = track(new THREE.MeshStandardMaterial({
    color: 0xa8936a,
    roughness: 0.45,
    metalness: 0.5,
  }))
  const rails: ThreeMesh[] = []
  for (let i = 0; i < 4; i += 1) {
    const rail = new THREE.Mesh(track(new THREE.BoxGeometry(1, 1, 1)), railMaterial)
    rail.position.y = 0.09
    rails.push(rail)
    tray.add(rail)
  }

  /* ---- slabs ------------------------------------------------------- */
  let slabs: Slab[] = []
  const pickables: ThreeMesh[] = []

  const labelMaterial = track(new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    opacity: 0.98,
  }))

  const rebuild = (items: readonly ArchiveArrayItem[]): void => {
    for (const slab of slabs) {
      world.remove(slab.group)
      if (slab.labelTexture) slab.labelTexture.dispose()
      slab.group.traverse((object) => {
        const mesh = object as unknown as { geometry?: { dispose(): void } }
        mesh.geometry?.dispose()
      })
      const material = slab.label.material as InstanceType<ThreeModule['MeshBasicMaterial']>
      material.map = null
    }
    slabs = []
    pickables.length = 0

    const slots = arrayLayout(items.length)
    const bounds = arrayBounds(slots)
    const trayWidth = bounds.width + SLAB_W + 1.5
    const trayDepth = bounds.depth + SLAB_D + 1.5
    plate.scale.set(trayWidth, 0.2, trayDepth)
    plate.position.y = -0.1
    groove.scale.set(trayWidth - 0.5, 0.05, trayDepth - 0.5)
    const railX = trayWidth / 2 - 0.25
    const railZ = trayDepth / 2 - 0.25
    rails[0].scale.set(0.12, 0.07, trayDepth - 0.4)
    rails[0].position.set(-railX, 0.1, 0)
    rails[1].scale.set(0.12, 0.07, trayDepth - 0.4)
    rails[1].position.set(railX, 0.1, 0)
    rails[2].scale.set(trayWidth - 0.4, 0.07, 0.12)
    rails[2].position.set(0, 0.1, -railZ)
    rails[3].scale.set(trayWidth - 0.4, 0.07, 0.12)
    rails[3].position.set(0, 0.1, railZ)

    const bodyGeometry = track(new THREE.BoxGeometry(SLAB_W, SLAB_H, SLAB_D))
    const edgeGeometry = track(new THREE.BoxGeometry(SLAB_W, 0.05, 0.05))
    const labelGeometry = track(new THREE.PlaneGeometry(SLAB_W - 0.24, SLAB_D - 0.2))
    const hoverGeometry = track(new THREE.BoxGeometry(SLAB_W + 0.06, 0.008, SLAB_D + 0.06))

    items.forEach((item, index) => {
      const slot = slots[index]
      const group = new THREE.Group()
      group.position.set(slot.x, 0, slot.z)

      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: item.running ? 0xf6eddf : 0xf3eee3,
        roughness: 0.34,
        metalness: 0.03,
        clearcoat: 0.85,
        clearcoatRoughness: 0.3,
        transparent: true,
        opacity: 0.97,
      })
      track(bodyMaterial)
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
      body.position.y = SLAB_H / 2
      group.add(body)

      const glowMaterial = new THREE.MeshStandardMaterial({
        color: 0xc98b3f,
        emissive: new THREE.Color(0xc98b3f),
        emissiveIntensity: 0.2,
        roughness: 0.4,
        metalness: 0.2,
      })
      track(glowMaterial)
      const glow = new THREE.Mesh(edgeGeometry, glowMaterial)
      glow.position.set(0, SLAB_H * 0.55, SLAB_D / 2 + 0.005)
      group.add(glow)

      const label = new THREE.Mesh(labelGeometry, labelMaterial.clone())
      track(label.material as ThreeMaterial)
      label.rotation.x = -Math.PI / 2
      label.position.set(0, SLAB_H + 0.006, 0)
      group.add(label)

      const hoverPlate = new THREE.Mesh(
        hoverGeometry,
        new THREE.MeshBasicMaterial({ color: 0xc98b3f, transparent: true, opacity: 0, depthWrite: false }),
      )
      track(hoverPlate.material as ThreeMaterial)
      hoverPlate.position.y = SLAB_H + 0.001
      group.add(hoverPlate)

      const pick = body as ThreeMesh
      pick.userData.index = index
      pickables.push(pick)
      body.userData.hoverPlate = hoverPlate

      const labelTexture = paintLabel(THREE, item, false)
      ;(label.material as InstanceType<ThreeModule['MeshBasicMaterial']>).map = labelTexture
      ;(label.material as InstanceType<ThreeModule['MeshBasicMaterial']>).needsUpdate = true

      world.add(group)
      slabs.push({
        group,
        slot,
        pick,
        glow,
        label,
        labelTexture,
        currentY: 0,
        targetY: 0,
        currentGlow: 0.2,
        targetGlow: 0.2,
      })
    })

    cameraTarget.set(0, 0.2, 0)
    cameraGoal.set(0, 0.2, 0)
    radiusGoal = Math.max(8.4, bounds.radius * 2.05 + 4.2)
    radius = state.reduced ? radiusGoal : radius
    applyState()
  }

  const applyState = (): void => {
    if (slabs.length && state.selected >= slabs.length) state.selected = 0
    const pulled = state.pulled >= 0 && state.pulled < slabs.length ? state.pulled : -1
    slabs.forEach((slab, index) => {
      const selected = index === state.selected
      const hovered = index === state.hovered
      slab.targetY = index === pulled
        ? LIFT_PULLED
        : selected
          ? LIFT_SELECTED
          : hovered
            ? LIFT_HOVER
            : 0
      slab.targetGlow = index === pulled ? 1.5 : selected ? 1.05 : hovered ? 0.6 : 0.2
      const material = slab.label.material as InstanceType<ThreeModule['MeshBasicMaterial']>
      if (!slab.labelTexture || !state.items[index]) return
      // Selected slabs are redrawn so the amber number follows the selection.
      if (material.map === slab.labelTexture && selected !== slab.pick.userData.selected) {
        slab.pick.userData.selected = selected
        const next = paintLabel(THREE, state.items[index], selected)
        slab.labelTexture.dispose()
        slab.labelTexture = next
        material.map = next
        material.needsUpdate = true
      }
    })
    const pulledGroup = pulled >= 0 ? slabs[pulled] : undefined
    const baseRadius = Math.max(8.4, arrayBounds(arrayLayout(state.items.length)).radius * 2.05 + 4.2)
    if (pulledGroup) {
      cameraGoal.set(pulledGroup.slot.x * 0.55, 1.55, pulledGroup.slot.z * 0.55)
      radiusGoal = Math.max(6.2, baseRadius * 0.74)
      pitchGoal = 0.47
      yawGoal = -0.18
    } else {
      cameraGoal.set(0, 0.2, 0)
      radiusGoal = baseRadius
      pitchGoal = 0.62
      yawGoal = -0.34
    }
    if (state.reduced) {
      slabSnap()
    }
  }

  const slabSnap = (): void => {
    for (const slab of slabs) {
      slab.currentY = slab.targetY
      slab.currentGlow = slab.targetGlow
      slab.group.position.y = slab.currentY
      const glowMaterial = slab.glow.material as InstanceType<ThreeModule['MeshStandardMaterial']>
      glowMaterial.emissiveIntensity = slab.currentGlow
    }
    yaw = yawGoal
    pitch = pitchGoal
    radius = radiusGoal
    cameraTarget.copy(cameraGoal)
    updateCamera()
    renderer.render(scene, camera)
  }

  const updateCamera = (): void => {
    const cos = Math.cos(pitch)
    camera.position.set(
      cameraTarget.x + radius * cos * Math.sin(yaw),
      cameraTarget.y + radius * Math.sin(pitch),
      cameraTarget.z + radius * cos * Math.cos(yaw),
    )
    camera.lookAt(cameraTarget)
  }

  /* ---- sizing ------------------------------------------------------ */
  const resize = (): void => {
    const width = host.clientWidth || 960
    const height = host.clientHeight || 520
    renderer.setSize(width, height, false)
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
    if (state.reduced) renderer.render(scene, camera)
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
  observer?.observe(host)
  resize()

  /* ---- pointer ----------------------------------------------------- */
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let downX = 0
  let downY = 0
  let dragging = false
  let wheelAccumulator = 0

  const hitIndex = (event: PointerEvent): number => {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(pickables, false)[0]
    return typeof hit?.object.userData.index === 'number' ? (hit.object.userData.index as number) : -1
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (dragging) {
      yawGoal = THREE.MathUtils.clamp(yawGoal - event.movementX * 0.0026, -0.9, 0.9)
      pitchGoal = THREE.MathUtils.clamp(pitchGoal + event.movementY * 0.0018, 0.32, 1.0)
      if (state.reduced) slabSnap()
      return
    }
    const index = hitIndex(event)
    if (index !== state.hovered) {
      state.hovered = index
      applyState()
      if (state.reduced) slabSnap()
    }
    canvas.style.cursor = index >= 0 ? 'pointer' : 'grab'
  }

  const onPointerDown = (event: PointerEvent): void => {
    downX = event.clientX
    downY = event.clientY
    dragging = true
    canvas.setPointerCapture?.(event.pointerId)
    canvas.style.cursor = 'grabbing'
  }

  const onPointerUp = (event: PointerEvent): void => {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY)
    dragging = false
    canvas.style.cursor = 'grab'
    if (moved > 6) return
    const index = hitIndex(event)
    if (index < 0) return
    if (index === state.selected) callbacks.pull(index)
    else callbacks.select(index)
  }

  const onPointerLeave = (): void => {
    if (state.hovered !== -1) {
      state.hovered = -1
      applyState()
      if (state.reduced) slabSnap()
    }
  }

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    wheelAccumulator += event.deltaY
    if (Math.abs(wheelAccumulator) < 48) return
    const direction = wheelAccumulator > 0 ? 1 : -1
    wheelAccumulator = 0
    const count = state.items.length
    if (!count) return
    callbacks.select((state.selected + direction + count) % count)
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  /* ---- loop -------------------------------------------------------- */
  let raf = 0
  let running = false
  let last = performance.now()

  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const ease = 7.5
    for (const slab of slabs) {
      slab.currentY = THREE.MathUtils.damp(slab.currentY, slab.targetY, ease, dt)
      slab.currentGlow = THREE.MathUtils.damp(slab.currentGlow, slab.targetGlow, ease, dt)
      slab.group.position.y = slab.currentY
      const glowMaterial = slab.glow.material as InstanceType<ThreeModule['MeshStandardMaterial']>
      glowMaterial.emissiveIntensity = slab.currentGlow
    }
    yaw = THREE.MathUtils.damp(yaw, yawGoal, 6, dt)
    pitch = THREE.MathUtils.damp(pitch, pitchGoal, 6, dt)
    radius = THREE.MathUtils.damp(radius, radiusGoal, 5, dt)
    cameraTarget.lerp(cameraGoal, Math.min(1, dt * 5))
    updateCamera()
    world.rotation.y = Math.sin(now * 0.00012) * 0.012
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  const start = (): void => {
    if (running || state.reduced) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const stop = (): void => {
    running = false
    cancelAnimationFrame(raf)
  }
  const onVisibility = (): void => {
    if (document.hidden) stop()
    else start()
  }
  document.addEventListener('visibilitychange', onVisibility)

  rebuild(state.items)
  if (state.reduced) slabSnap()
  else start()

  return {
    setState(next) {
      const itemsChanged = next.items !== state.items
      state.items = next.items
      state.selected = next.selected
      state.pulled = next.pulled
      if (itemsChanged) rebuild(next.items)
      else applyState()
      if (state.reduced) slabSnap()
    },
    dispose() {
      stop()
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      for (const slab of slabs) slab.labelTexture?.dispose()
      for (const item of trash) item.dispose()
      renderer.dispose()
    },
  }
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function ArchiveArray({
  items,
  selectedId,
  pulledId,
  onSelect,
  onPull,
  className,
  label,
}: ArchiveArrayProps) {
  const reduced = usePrefersReducedMotion()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<SceneHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(() => !isBrowser() || !supportsWebGL())

  const indexOf = (id: string | null): number => items.findIndex((item) => item.id === id)
  const selected = Math.max(0, indexOf(selectedId))
  const pulled = indexOf(pulledId)

  // Keep the newest callbacks/state reachable from the long-lived scene.
  const live = useRef({ items, selected, pulled, onSelect, onPull })
  live.current = { items, selected, pulled, onSelect, onPull }

  useEffect(() => {
    if (fallback) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    let disposed = false
    let handle: SceneHandle | null = null
    void import('three')
      .then((THREE) => {
        if (disposed) return
        handle = createScene(
          THREE,
          canvas,
          host,
          {
            items: live.current.items,
            selected: live.current.selected,
            pulled: live.current.pulled,
            hovered: -1,
            reduced,
          },
          {
            select: (index) => {
              const item = live.current.items[index]
              if (item) live.current.onSelect(item.id)
            },
            pull: (index) => {
              const item = live.current.items[index]
              if (item) live.current.onPull(item.id)
            },
          },
        )
        handleRef.current = handle
        setReady(true)
      })
      .catch(() => {
        if (!disposed) setFallback(true)
      })
    return () => {
      disposed = true
      handle?.dispose()
      handleRef.current = null
    }
  }, [fallback, reduced])

  useEffect(() => {
    handleRef.current?.setState({ items, selected, pulled })
  }, [items, selected, pulled])

  if (fallback) {
    return (
      <ArchiveArrayLite
        items={items}
        selectedId={selectedId}
        pulledId={pulledId}
        onSelect={onSelect}
        onPull={onPull}
        className={className}
        label={label}
      />
    )
  }

  return (
    <div
      ref={hostRef}
      className={clsx('rh-array', !ready && 'is-loading', className)}
      role="listbox"
      aria-label={label ?? '档案阵列'}
    >
      <canvas ref={canvasRef} className="rh-array__canvas" aria-hidden="true" />
      <span className="rh-array__hint" aria-hidden="true">
        DRAG TO TILT · CLICK TO PULL OUT
      </span>
      <ul className="rh-visually-hidden">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => (item.id === selectedId ? onPull(item.id) : onSelect(item.id))}
            >
              {item.number} {item.version} {item.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** DOM-only rack used without WebGL: same selection and pull-out semantics. */
export function ArchiveArrayLite({
  items,
  selectedId,
  pulledId,
  onSelect,
  onPull,
  className,
  label,
}: ArchiveArrayProps) {
  return (
    <div className={clsx('rh-array-lite', className)} role="listbox" aria-label={label ?? '档案阵列'}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === selectedId}
          className={clsx(
            'rh-array-lite__card',
            item.id === selectedId && 'is-selected',
            item.id === pulledId && 'is-pulled',
          )}
          onClick={() => (item.id === selectedId ? onPull(item.id) : onSelect(item.id))}
        >
          <span className="rh-array-lite__number">{item.number}</span>
          <span className="rh-array-lite__version">{item.version || '未安装'}</span>
          <span className="rh-array-lite__name">{item.name}</span>
          <span className="rh-array-lite__loader">{item.loader}</span>
        </button>
      ))}
    </div>
  )
}
