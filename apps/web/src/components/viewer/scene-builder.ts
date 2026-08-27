import * as THREE from 'three'
import type { BoxSolid, SceneModel, SlabSolid, SolidKind } from '@buildflow/spatial'

/**
 * SceneModel → Three.js meshes. docs/08 §8.1, §8.4
 *
 * The pipeline's second half. `extrudePlan` decided WHAT exists and where;
 * this turns that into geometry, and it does one thing of consequence:
 * MERGES BY MATERIAL. docs/08 §8.4 puts the difference at roughly 800 draw
 * calls versus 30, and a villa is easily eight hundred boxes once every lintel
 * and spandrel is counted.
 *
 * Materials are flat colours for now. Binding them to catalogue textures — and
 * to the BOQ line each one prices — is sprint 10, which is the point of the
 * whole module: docs/08 §8.3 calls the viewer "a pricing interface wearing a
 * visualisation costume".
 */

export type SurfaceKind = SolidKind | 'floor' | 'ceiling'

/**
 * The surfaces a person picks a finish for.
 *
 * Narrower than estimation's `FinishSurface`, which also prices skirting — a
 * run of skirting is quantified and billed but not modelled as its own solid,
 * so there is nothing here to repaint.
 */
export type DrawnSurface = 'floor' | 'wall' | 'ceiling'

/** Placeholder finishes: plaster, screed, concrete. Swapped for textures in sprint 10. */
const PALETTE: Record<SurfaceKind, { colour: number; roughness: number; metalness: number }> = {
  wall: { colour: 0xf2efe9, roughness: 0.92, metalness: 0 },
  lintel: { colour: 0xf2efe9, roughness: 0.92, metalness: 0 },
  spandrel: { colour: 0xf2efe9, roughness: 0.92, metalness: 0 },
  column: { colour: 0xd8d4cc, roughness: 0.85, metalness: 0 },
  beam: { colour: 0xd8d4cc, roughness: 0.85, metalness: 0 },
  floor: { colour: 0xcfc4b4, roughness: 0.7, metalness: 0 },
  ceiling: { colour: 0xfaf8f5, roughness: 0.95, metalness: 0 },
}

/** Floors read as rooms at a glance when the type tints them. */
const ROOM_TINT: Record<string, number> = {
  bathroom: 0xbcd4d8,
  guest_bathroom: 0xbcd4d8,
  kitchen: 0xd6d0c4,
  balcony: 0xc8c8c2,
  staircase: 0xc4c0ba,
  corridor: 0xd2cabc,
}

export interface BuiltScene {
  /** One group holding every merged mesh — added to and removed from the scene as a unit. */
  root: THREE.Group
  /** Axis-aligned boxes of the walls, for walkthrough collision. */
  colliders: THREE.Box3[]
  drawCalls: number
  /**
   * The live materials, by surface.
   *
   * Kept so a finish change can repaint rather than rebuild: docs/08 §8.3 is
   * explicit that selecting a tile updates the MATERIAL and nothing else, and
   * a scene rebuild would drop the camera and stall for a beat on every click.
   */
  materials: Map<SurfaceKind, THREE.MeshStandardMaterial[]>
}

export const materialFor = (kind: SurfaceKind, tint?: number): THREE.MeshStandardMaterial => {
  const spec = PALETTE[kind]
  return new THREE.MeshStandardMaterial({
    color: tint ?? spec.colour,
    roughness: spec.roughness,
    metalness: spec.metalness,
  })
}

function boxGeometry(solid: BoxSolid): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(solid.size.x, solid.size.y, solid.size.z)
  // Baked into the vertices rather than left on a Mesh: merging needs every
  // contributor already in world space.
  geometry.rotateY(solid.rotationY)
  geometry.translate(solid.centre.x, solid.centre.y, solid.centre.z)
  return geometry
}

/**
 * A slab as an extruded outline.
 *
 * The plan's Y becomes the scene's Z, so the shape is built in XY and then
 * laid flat by a −90° rotation about X. Extruding downward from the elevation
 * keeps `elevation` meaning the same thing it does in the model: the BOTTOM
 * face.
 */
function slabGeometry(slab: SlabSolid): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  slab.outline.forEach((vertex, index) => {
    if (index === 0) shape.moveTo(vertex.x, vertex.z)
    else shape.lineTo(vertex.x, vertex.z)
  })
  shape.closePath()

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: slab.thickness,
    bevelEnabled: false,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, slab.elevation + slab.thickness, 0)
  return geometry
}

/**
 * Merges geometries that share a material into one mesh.
 *
 * Written by hand rather than with `BufferGeometryUtils.mergeGeometries`: the
 * utility lives in `three/examples`, whose deep import paths are a recurring
 * source of build breakage across Three versions, and concatenating position
 * and normal arrays for boxes is a dozen lines.
 */
function mergeAll(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null

  const indexed = geometries.map((geometry) => geometry.toNonIndexed())
  const total = indexed.reduce(
    (count, geometry) => count + geometry.getAttribute('position').count,
    0,
  )

  const positions = new Float32Array(total * 3)
  const normals = new Float32Array(total * 3)
  const uvs = new Float32Array(total * 2)

  let vertex = 0
  for (const geometry of indexed) {
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    // Asked for by name rather than tested for truthiness: both sources here
    // do carry UVs, but a geometry that did not would fail silently with
    // zeroed coordinates rather than loudly.
    const hasUv = geometry.hasAttribute('uv')
    const uv = hasUv ? geometry.getAttribute('uv') : null

    for (let index = 0; index < position.count; index += 1) {
      positions[(vertex + index) * 3] = position.getX(index)
      positions[(vertex + index) * 3 + 1] = position.getY(index)
      positions[(vertex + index) * 3 + 2] = position.getZ(index)

      normals[(vertex + index) * 3] = normal.getX(index)
      normals[(vertex + index) * 3 + 1] = normal.getY(index)
      normals[(vertex + index) * 3 + 2] = normal.getZ(index)

      uvs[(vertex + index) * 2] = uv === null ? 0 : uv.getX(index)
      uvs[(vertex + index) * 2 + 1] = uv === null ? 0 : uv.getY(index)
    }
    vertex += position.count
    geometry.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  merged.computeBoundingSphere()
  return merged
}

export function buildScene(model: SceneModel): BuiltScene {
  const root = new THREE.Group()
  root.name = 'plan'

  const byKind = new Map<
    string,
    { kind: SurfaceKind; tint?: number; parts: THREE.BufferGeometry[] }
  >()
  const push = (key: string, kind: SurfaceKind, geometry: THREE.BufferGeometry, tint?: number) => {
    const bucket = byKind.get(key)
    if (bucket) bucket.parts.push(geometry)
    else byKind.set(key, { kind, parts: [geometry], ...(tint === undefined ? {} : { tint }) })
  }

  const colliders: THREE.Box3[] = []
  for (const solid of model.boxes) {
    const geometry = boxGeometry(solid)
    push(solid.kind, solid.kind, geometry)

    // Collision uses the AABB rather than the turned box: a capsule against an
    // oriented box is a solved problem nobody needs to re-solve for a wall
    // that is 200 mm thick and axis-aligned nine times in ten.
    if (solid.kind !== 'beam') {
      colliders.push(
        new THREE.Box3().setFromBufferAttribute(
          geometry.getAttribute('position') as THREE.BufferAttribute,
        ),
      )
    }
  }

  for (const slab of model.slabs) {
    const tint = slab.typeCode ? ROOM_TINT[slab.typeCode] : undefined
    push(`${slab.kind}:${slab.typeCode ?? 'none'}`, slab.kind, slabGeometry(slab), tint)
  }

  let drawCalls = 0
  const materials = new Map<SurfaceKind, THREE.MeshStandardMaterial[]>()

  for (const bucket of byKind.values()) {
    const merged = mergeAll(bucket.parts)
    if (!merged) continue

    const material = materialFor(bucket.kind, bucket.tint)
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = bucket.kind !== 'floor'
    mesh.receiveShadow = true
    root.add(mesh)
    drawCalls += 1

    const existing = materials.get(bucket.kind)
    if (existing) existing.push(material)
    else materials.set(bucket.kind, [material])
  }

  return { root, colliders, drawCalls, materials }
}

/**
 * Which drawn surfaces a chosen finish covers.
 *
 * A wall finish reaches its lintels and spandrels too — those are wall, cut
 * into pieces by an opening, and leaving them the old colour would draw a
 * ghost of every door on the newly painted wall.
 */
const COVERED: Record<DrawnSurface, SurfaceKind[]> = {
  floor: ['floor'],
  wall: ['wall', 'lintel', 'spandrel'],
  ceiling: ['ceiling'],
}

/** Repaints a surface in place. No geometry is touched. docs/08 §8.3 */
export function applyFinish(built: BuiltScene, surface: DrawnSurface, colour: number): void {
  for (const kind of COVERED[surface]) {
    for (const material of built.materials.get(kind) ?? []) material.color.setHex(colour)
  }
}

/** Frees GPU memory. A viewer that leaks a scene per plan crashes a long session. */
export function disposeScene(built: BuiltScene): void {
  built.root.traverse((node: THREE.Object3D) => {
    if (!(node instanceof THREE.Mesh)) return

    // Re-typed because `Mesh` is generic and `traverse` hands back the base
    // class, which erases what its geometry and material actually are.
    const mesh = node as THREE.Mesh
    mesh.geometry.dispose()

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) material.dispose()
  })
  built.root.clear()
}
