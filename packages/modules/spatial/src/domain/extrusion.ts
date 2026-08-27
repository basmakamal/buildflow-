import { angleDegrees, distance, type Point } from './geometry'
import { openingsOn, type Opening } from './opening'
import type { PlanGeometry } from './plan'
import type { RoomBoundary } from './room'
import { isBeam, type StructuralElement } from './structural'
import { wallLengthMm, type Wall } from './wall'

/**
 * The 3D generation pipeline — SOLIDS, not meshes. docs/08 §8.1
 *
 * Turns a floor plan into the boxes and slabs a renderer builds geometry from.
 * No Three.js here: this is arithmetic, and arithmetic that decides where a
 * lintel sits should be testable without a WebGL context.
 *
 * OPENINGS ARE CUT BY DECOMPOSITION, NOT BY CSG.
 *
 * docs/08 §8.1 specifies a boolean subtraction per wall via three-bvh-csg,
 * cached by geometry hash. This does the same job by splitting the wall into
 * the panels that survive around each opening — the piece before it, the
 * spandrel under a window, the lintel over the head, the piece after. For a
 * RECTANGULAR opening in a STRAIGHT wall the two produce identical solids,
 * and decomposition is exact rather than approximate, needs no library, needs
 * no cache because it is arithmetic, and cannot produce the coincident faces
 * that make booleans flicker.
 *
 * The trade is real and worth stating: an arched or circular opening cannot be
 * expressed this way. `plan_openings` models arch and niche types (docs/04
 * §2.5) that the planner does not yet draw; when it does, those specific
 * openings will need the boolean path, and everything else can stay here.
 *
 * Units: plan millimetres in, METRES out — the boundary docs/18 ADR-016 sets,
 * crossed exactly once, here.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** The plan's XY becomes the scene's XZ; Y is up, as every renderer expects. */
export interface Vec2 {
  x: number
  z: number
}

export type SolidKind = 'wall' | 'lintel' | 'spandrel' | 'column' | 'beam'

/**
 * A rectangular block, centred, turned about the vertical axis.
 *
 * One primitive covers walls, the pieces around openings, columns and beams —
 * so the renderer builds one kind of thing and the material is the only
 * difference between them.
 */
export interface BoxSolid {
  id: string
  kind: SolidKind
  /** The wall or element this came from, for selection and material binding. */
  sourceId: string
  centre: Vec3
  size: Vec3
  /** Radians, about Y. */
  rotationY: number
}

export type SlabKind = 'floor' | 'ceiling'

export interface SlabSolid {
  id: string
  kind: SlabKind
  roomId: string
  /** The room's outline in metres, on the XZ plane. */
  outline: Vec2[]
  /** Metres above finished floor level — the slab's BOTTOM face. */
  elevation: number
  thickness: number
  /** What the room is, so a renderer can pick tiles for a bathroom. */
  typeCode: string | null
}

export interface SceneModel {
  boxes: BoxSolid[]
  slabs: SlabSolid[]
  /** The scene's extent in metres — what a camera frames on open. */
  bounds: { min: Vec3; max: Vec3 } | null
}

export interface ExtrudeOptions {
  /** Structural slab thickness. Cosmetic: it is only ever seen edge-on. */
  slabThicknessM?: number
  /** Ceilings are heavy in a walkthrough and hide everything in a top view. */
  includeCeilings?: boolean
}

const M = 1000
const toMetres = (valueMm: number): number => valueMm / M
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

const DEFAULT_SLAB_M = 0.15

/**
 * One panel of a wall: a run along its length, between two heights.
 *
 * `fromMm`/`toMm` are distances along the centreline from the wall's start,
 * which is exactly how an opening stores its own position — so the two never
 * need converting to compare.
 */
interface Panel {
  kind: SolidKind
  fromMm: number
  toMm: number
  baseMm: number
  topMm: number
}

/**
 * Splits a wall into the solid pieces that survive its openings.
 *
 * Exported because it is the heart of the pipeline and deserves its own tests:
 * a lintel that lands a few millimetres wrong is invisible in a screenshot and
 * obvious to anyone who walks through the door.
 */
export function wallPanels(wall: Wall, openings: readonly Opening[]): Panel[] {
  const lengthMm = wallLengthMm(wall)
  const panels: Panel[] = []

  const ordered = [...openings].sort((left, right) => left.offsetMm - right.offsetMm)
  let cursor = 0

  for (const opening of ordered) {
    const start = Math.max(cursor, opening.offsetMm)
    const end = Math.min(lengthMm, opening.offsetMm + opening.widthMm)
    if (end <= start) continue

    // Solid wall between the last opening and this one.
    if (start > cursor) {
      panels.push({ kind: 'wall', fromMm: cursor, toMm: start, baseMm: 0, topMm: wall.heightMm })
    }

    // A window sits on a spandrel; a door's sill is zero, so this is skipped.
    if (opening.sillMm > 0) {
      panels.push({ kind: 'spandrel', fromMm: start, toMm: end, baseMm: 0, topMm: opening.sillMm })
    }

    // The lintel over the head, unless the opening runs to the underside of
    // the slab — a full-height doorway has no lintel, and inventing a
    // zero-thickness one would leave a z-fighting sliver.
    const headMm = opening.sillMm + opening.heightMm
    if (headMm < wall.heightMm) {
      panels.push({
        kind: 'lintel',
        fromMm: start,
        toMm: end,
        baseMm: headMm,
        topMm: wall.heightMm,
      })
    }

    cursor = Math.max(cursor, end)
  }

  if (cursor < lengthMm) {
    panels.push({ kind: 'wall', fromMm: cursor, toMm: lengthMm, baseMm: 0, topMm: wall.heightMm })
  }

  return panels
}

/** Places a panel in the scene: along the wall, at its own height. */
function boxOf(wall: Wall, panel: Panel, index: number): BoxSolid {
  const headingDeg = angleDegrees(wall.start, wall.end)
  const headingRad = toRadians(headingDeg)

  const midMm = (panel.fromMm + panel.toMm) / 2
  const centreXMm = wall.start.x + Math.cos(headingRad) * midMm
  const centreYMm = wall.start.y + Math.sin(headingRad) * midMm

  return {
    id: `${wall.id}:${panel.kind}:${index}`,
    kind: panel.kind,
    sourceId: wall.id,
    centre: {
      x: toMetres(centreXMm),
      y: toMetres((panel.baseMm + panel.topMm) / 2),
      z: toMetres(centreYMm),
    },
    size: {
      x: toMetres(panel.toMm - panel.fromMm),
      y: toMetres(panel.topMm - panel.baseMm),
      z: toMetres(wall.thicknessMm),
    },
    // Negated: a Y rotation turns the box's local +X towards −Z, while a plan
    // bearing turns towards +Z. Getting this backwards mirrors the whole
    // building, which looks plausible until somebody checks a door.
    rotationY: -headingRad,
  }
}

function structuralBox(element: StructuralElement): BoxSolid {
  if (isBeam(element)) {
    const lengthMm = distance(element.start, element.end)
    const headingRad = toRadians(angleDegrees(element.start, element.end))
    return {
      id: `${element.id}:beam`,
      kind: 'beam',
      sourceId: element.id,
      centre: {
        x: toMetres((element.start.x + element.end.x) / 2),
        y: toMetres(DEFAULT_CEILING_FOR_BEAM_MM - element.depthMm / 2),
        z: toMetres((element.start.y + element.end.y) / 2),
      },
      size: {
        x: toMetres(lengthMm),
        y: toMetres(element.depthMm),
        z: toMetres(element.widthMm),
      },
      rotationY: -headingRad,
    }
  }

  return {
    id: `${element.id}:column`,
    kind: 'column',
    sourceId: element.id,
    centre: {
      x: toMetres(element.centre.x),
      y: toMetres(element.heightMm / 2),
      z: toMetres(element.centre.y),
    },
    size: {
      x: toMetres(element.widthMm),
      y: toMetres(element.heightMm),
      z: toMetres(element.depthMm),
    },
    rotationY: -toRadians(element.rotationDeg),
  }
}

/**
 * Where a beam's soffit sits when nothing else says.
 *
 * Beams hang from the storey above, so they are placed from the ceiling down
 * rather than from the floor up — a beam drawn at floor level would be a trip
 * hazard rather than a downstand.
 */
const DEFAULT_CEILING_FOR_BEAM_MM = 3000

const outlineOf = (polygon: readonly Point[]): Vec2[] =>
  polygon.map((vertex) => ({ x: toMetres(vertex.x), z: toMetres(vertex.y) }))

function boundsOfScene(boxes: readonly BoxSolid[], slabs: readonly SlabSolid[]) {
  if (boxes.length === 0 && slabs.length === 0) return null

  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity }
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity }

  const stretch = (x: number, y: number, z: number) => {
    min.x = Math.min(min.x, x)
    min.y = Math.min(min.y, y)
    min.z = Math.min(min.z, z)
    max.x = Math.max(max.x, x)
    max.y = Math.max(max.y, y)
    max.z = Math.max(max.z, z)
  }

  for (const box of boxes) {
    // The rotated footprint's true extent needs the corners; half the diagonal
    // is a cheap bound that never under-reports, which is what a camera needs.
    const reach = Math.hypot(box.size.x, box.size.z) / 2
    stretch(box.centre.x - reach, box.centre.y - box.size.y / 2, box.centre.z - reach)
    stretch(box.centre.x + reach, box.centre.y + box.size.y / 2, box.centre.z + reach)
  }
  for (const slab of slabs) {
    for (const vertex of slab.outline) {
      stretch(vertex.x, slab.elevation, vertex.z)
      stretch(vertex.x, slab.elevation + slab.thickness, vertex.z)
    }
  }

  return { min, max }
}

/**
 * The whole scene, in metres.
 *
 * Rooms come from detection rather than from the walls: a floor slab is the
 * space a wall loop encloses, and that is precisely what room detection
 * already computed. Deriving it twice would let the 3D floor and the BOQ's
 * floor area disagree, which is the one difference nobody would notice until
 * a client did.
 */
export function extrudePlan(
  geometry: PlanGeometry,
  rooms: readonly RoomBoundary[],
  options: ExtrudeOptions = {},
): SceneModel {
  const slabThickness = options.slabThicknessM ?? DEFAULT_SLAB_M

  const boxes = geometry.walls.flatMap((wall) =>
    wallPanels(wall, openingsOn(geometry.openings, wall.id)).map((panel, index) =>
      boxOf(wall, panel, index),
    ),
  )
  for (const element of geometry.structural) boxes.push(structuralBox(element))

  const slabs: SlabSolid[] = []
  for (const room of rooms) {
    if (room.polygon.length < 3) continue

    slabs.push({
      id: `${room.id}:floor`,
      kind: 'floor',
      roomId: room.id,
      outline: outlineOf(room.polygon),
      elevation: -slabThickness,
      thickness: slabThickness,
      typeCode: room.typeCode,
    })

    if (options.includeCeilings) {
      slabs.push({
        id: `${room.id}:ceiling`,
        kind: 'ceiling',
        roomId: room.id,
        outline: outlineOf(room.polygon),
        elevation: toMetres(room.ceilingHeightMm),
        thickness: slabThickness,
        typeCode: room.typeCode,
      })
    }
  }

  return { boxes, slabs, bounds: boundsOfScene(boxes, slabs) }
}

/** Draw-call arithmetic, for the viewer's diagnostics. docs/08 §8.4 */
export const solidCount = (scene: SceneModel): number => scene.boxes.length + scene.slabs.length
