import * as THREE from 'three'

/**
 * The three camera modes. docs/08 §8.2
 *
 * Written by hand rather than pulled from `three/examples/jsm`. Orbiting is
 * spherical coordinates and a drag, walking is a velocity and a collision
 * test; what the example controls add is a hundred settings and a deep import
 * path that moves between Three releases. Owning eighty lines here also means
 * the clamps can be the ones the DOCUMENT asks for — orbit distance bounded by
 * the room, eye height fixed at 1.65 m, no flying — rather than whatever the
 * library defaults to.
 */

export type CameraMode = 'room' | 'walkthrough' | 'top'

export const CAMERA_MODES: CameraMode[] = ['room', 'walkthrough', 'top']

/** Eye height for an adult standing. docs/08 §8.2 */
const EYE_HEIGHT = 1.65
/** Metres per second. A brisk walk, not a sprint through somebody's home. */
const WALK_SPEED = 2.6
/** How far the body keeps from a wall — half a shoulder width. */
const BODY_RADIUS = 0.28
/** Where the dollhouse view cuts the walls off. docs/08 §8.2 */
const TOP_CLIP_HEIGHT = 1.2

const MIN_PITCH = -Math.PI / 2 + 0.05
const MAX_PITCH = Math.PI / 2 - 0.05

export interface SceneExtent {
  centre: THREE.Vector3
  /** Half-diagonal of the scene, in metres — what "far enough back" means. */
  radius: number
}

export interface CameraRig {
  readonly camera: THREE.Camera
  mode: CameraMode
  setMode: (mode: CameraMode) => void
  /** Points the camera at something: a room's centroid, or the whole plan. */
  focus: (target: THREE.Vector3, radius: number) => void
  resize: (width: number, height: number) => void
  update: (deltaSeconds: number, colliders: readonly THREE.Box3[]) => void
  dispose: () => void
}

export function createCameraRig(
  host: HTMLElement,
  renderer: THREE.WebGLRenderer,
  extent: SceneExtent,
): CameraRig {
  const perspective = new THREE.PerspectiveCamera(60, 1, 0.05, 500)
  const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500)

  let mode: CameraMode = 'room'

  // Orbit state, in spherical coordinates about `target`.
  const target = extent.centre.clone()
  let distance = Math.max(4, extent.radius * 1.8)
  let minDistance = 1.5
  let maxDistance = Math.max(8, extent.radius * 4)
  let theta = Math.PI / 4
  let phi = Math.PI / 3.2

  // Walkthrough state.
  const position = new THREE.Vector3(extent.centre.x, EYE_HEIGHT, extent.centre.z)
  let yaw = 0
  let pitch = 0
  const held = new Set<string>()

  let dragging = false
  let panning = false
  let lastPointer = { x: 0, y: 0 }
  let width = 1
  let height = 1

  /** The dollhouse clip. Global on the renderer, so no material has to know. */
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), TOP_CLIP_HEIGHT)
  renderer.localClippingEnabled = true

  function applyOrbit() {
    perspective.position.set(
      target.x + distance * Math.sin(phi) * Math.cos(theta),
      target.y + distance * Math.cos(phi),
      target.z + distance * Math.sin(phi) * Math.sin(theta),
    )
    perspective.lookAt(target)
  }

  function applyWalk() {
    perspective.position.copy(position)
    // Yaw then pitch, in that order: the reverse rolls the horizon, which is
    // instantly nauseating.
    perspective.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
  }

  function applyTop() {
    const span = Math.max(4, extent.radius * 1.2)
    const aspect = width / Math.max(1, height)
    ortho.left = -span * aspect
    ortho.right = span * aspect
    ortho.top = span
    ortho.bottom = -span
    ortho.position.set(target.x, extent.radius * 2 + 10, target.z)
    ortho.up.set(0, 0, -1)
    ortho.lookAt(target.x, 0, target.z)
    ortho.updateProjectionMatrix()
  }

  // ── input ─────────────────────────────────────────────────────────────────

  const onPointerDown = (event: PointerEvent) => {
    host.setPointerCapture(event.pointerId)
    lastPointer = { x: event.clientX, y: event.clientY }
    // Right button, or shift, pans the target rather than orbiting round it.
    panning = event.button === 2 || event.shiftKey
    dragging = true

    if (mode === 'walkthrough' && event.button === 0) {
      void host.requestPointerLock()
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (mode === 'walkthrough') {
      if (document.pointerLockElement !== host) return
      yaw -= event.movementX * 0.0022
      pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch - event.movementY * 0.0022))
      return
    }
    if (!dragging) return

    const dx = event.clientX - lastPointer.x
    const dy = event.clientY - lastPointer.y
    lastPointer = { x: event.clientX, y: event.clientY }

    if (panning || mode === 'top') {
      // Pan along the ground plane, scaled by distance so the drag tracks the
      // cursor at any zoom.
      const speed = mode === 'top' ? extent.radius * 0.004 : distance * 0.0016
      target.x -= (dx * Math.cos(theta) + dy * Math.sin(theta)) * speed
      target.z -= (dx * Math.sin(theta) - dy * Math.cos(theta)) * speed
      return
    }

    theta -= dx * 0.006
    phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.02, phi - dy * 0.006))
  }

  const onPointerUp = (event: PointerEvent) => {
    host.releasePointerCapture(event.pointerId)
    dragging = false
    panning = false
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12

    if (mode === 'top') {
      extent.radius = Math.max(2, Math.min(400, extent.radius * factor))
      return
    }
    distance = Math.max(minDistance, Math.min(maxDistance, distance * factor))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return
    held.add(event.key.toLowerCase())
  }
  const onKeyUp = (event: KeyboardEvent) => {
    held.delete(event.key.toLowerCase())
  }
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  host.addEventListener('pointerdown', onPointerDown)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', onPointerUp)
  host.addEventListener('wheel', onWheel, { passive: false })
  host.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  // ── walking ───────────────────────────────────────────────────────────────

  /**
   * Moves the body, refusing any step that would end inside a wall.
   *
   * The two axes are tested SEPARATELY so that walking into a wall at an angle
   * slides along it instead of stopping dead — the difference between a
   * walkthrough that feels like a game and one that feels broken.
   */
  function step(deltaSeconds: number, colliders: readonly THREE.Box3[]) {
    const forward = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)
    const strafe = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0)
    if (forward === 0 && strafe === 0) return

    const speed = WALK_SPEED * deltaSeconds * (held.has('shift') ? 2 : 1)
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)

    const moveX = (-sin * forward + cos * strafe) * speed
    const moveZ = (-cos * forward - sin * strafe) * speed

    const blocked = (x: number, z: number) => {
      const body = new THREE.Box3(
        new THREE.Vector3(x - BODY_RADIUS, EYE_HEIGHT - 1.5, z - BODY_RADIUS),
        new THREE.Vector3(x + BODY_RADIUS, EYE_HEIGHT, z + BODY_RADIUS),
      )
      return colliders.some((collider) => collider.intersectsBox(body))
    }

    if (!blocked(position.x + moveX, position.z)) position.x += moveX
    if (!blocked(position.x, position.z + moveZ)) position.z += moveZ
    position.y = EYE_HEIGHT
  }

  const rig: CameraRig = {
    get camera() {
      return mode === 'top' ? ortho : perspective
    },
    get mode() {
      return mode
    },
    set mode(next: CameraMode) {
      rig.setMode(next)
    },

    setMode(next: CameraMode) {
      mode = next
      renderer.clippingPlanes = next === 'top' ? [clipPlane] : []

      if (next === 'walkthrough') {
        // Start where the orbit camera was looking, at eye height — arriving
        // in a corner of the plot with no idea which way is in is disorienting.
        position.set(target.x, EYE_HEIGHT, target.z)
        yaw = -theta - Math.PI / 2
        pitch = 0
      } else if (document.pointerLockElement === host) {
        document.exitPointerLock()
      }
    },

    focus(next: THREE.Vector3, radius: number) {
      target.copy(next)
      // Clamped to the thing being looked at, per docs/08 §8.2: a room view
      // that can retreat to the next emirate is not a room view.
      minDistance = Math.max(0.8, radius * 0.4)
      maxDistance = Math.max(minDistance + 2, radius * 5)
      distance = Math.max(minDistance, Math.min(maxDistance, radius * 2))
    },

    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth
      height = nextHeight
      perspective.aspect = nextWidth / Math.max(1, nextHeight)
      perspective.updateProjectionMatrix()
    },

    update(deltaSeconds: number, colliders: readonly THREE.Box3[]) {
      if (mode === 'walkthrough') {
        step(deltaSeconds, colliders)
        applyWalk()
        return
      }
      if (mode === 'top') {
        applyTop()
        return
      }
      applyOrbit()
    },

    dispose() {
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (document.pointerLockElement === host) document.exitPointerLock()
      renderer.clippingPlanes = []
    },
  }

  return rig
}
