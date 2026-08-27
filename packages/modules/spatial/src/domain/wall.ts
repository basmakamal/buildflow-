import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import {
  angleDegrees,
  boundsOf,
  distance,
  distanceToSegment,
  midpoint,
  mm,
  point,
  pointAtAngle,
  type Bounds,
  type Point,
  type Segment,
} from './geometry'

/**
 * The wall — the planner's primary entity. docs/02 §3.5
 *
 * A wall is a CENTRELINE plus a thickness, not a rectangle. Storing the
 * centreline is what makes the rest of the phase possible: two walls meeting
 * at a corner share an exactly equal endpoint (docs/18 ADR-016), room
 * detection is then a graph problem over those shared nodes, and the thick
 * quad the user sees is derived at draw time. Storing corners instead would
 * mean rediscovering the topology on every edit.
 *
 * Invariants, from docs/02 §3.5:
 *   · coordinates are integer millimetres;
 *   · a wall may not have zero length;
 *   · thickness and height are positive.
 *
 * Every mutator returns a NEW wall and a `Result`, because "you cannot drag
 * this endpoint onto the other one" is an ordinary outcome of a drag, not a
 * bug. docs/06 §3.3
 */

export interface Wall {
  id: string
  /** Centreline ends, integer millimetres. */
  start: Point
  end: Point
  thicknessMm: number
  heightMm: number
  /** Free-form layer name — the plan's own organisation, not the Konva layer. */
  layer: string
}

/** A 200 mm blockwork partition and a 3 m storey — the regional default. */
export const DEFAULT_WALL_THICKNESS_MM = 200
export const DEFAULT_WALL_HEIGHT_MM = 3000

/**
 * Shorter than this is a click that wandered, not a wall. One millimetre would
 * technically satisfy "not zero", but a 1 mm wall is invisible, unselectable
 * and would poison room detection with a degenerate node.
 */
export const MIN_WALL_LENGTH_MM = 10

export const DEFAULT_LAYER = 'default'

export interface WallInput {
  id: string
  start: Point
  end: Point
  thicknessMm?: number
  heightMm?: number
  layer?: string
}

export function createWall(input: WallInput): Result<Wall, DomainError> {
  const start = point(input.start.x, input.start.y)
  const end = point(input.end.x, input.end.y)
  const thicknessMm = mm(input.thicknessMm ?? DEFAULT_WALL_THICKNESS_MM)
  const heightMm = mm(input.heightMm ?? DEFAULT_WALL_HEIGHT_MM)

  if (distance(start, end) < MIN_WALL_LENGTH_MM) {
    return err(
      validationError('WALL_TOO_SHORT', `A wall must be at least ${MIN_WALL_LENGTH_MM} mm long`, {
        minimumMm: MIN_WALL_LENGTH_MM,
      }),
    )
  }
  if (thicknessMm <= 0) {
    return err(validationError('WALL_INVALID_THICKNESS', 'Wall thickness must be positive'))
  }
  if (heightMm <= 0) {
    return err(validationError('WALL_INVALID_HEIGHT', 'Wall height must be positive'))
  }

  return ok({
    id: input.id,
    start,
    end,
    thicknessMm,
    heightMm,
    layer: input.layer ?? DEFAULT_LAYER,
  })
}

export const wallSegment = (wall: Wall): Segment => ({ start: wall.start, end: wall.end })

/** Centreline length in millimetres, rounded to the millimetre a plan stores. */
export const wallLengthMm = (wall: Wall): number => mm(distance(wall.start, wall.end))

/** Direction in degrees, 0 = east. What a dimension edit holds constant. */
export const wallAngleDeg = (wall: Wall): number => angleDegrees(wall.start, wall.end)

export const wallMidpoint = (wall: Wall): Point => midpoint(wall.start, wall.end)

/**
 * The four corners of the drawn wall, offset half a thickness either side of
 * the centreline.
 *
 * Wound consistently (left side first, then right side reversed) so the result
 * is a simple, non-self-intersecting quad that a renderer can fill and, later,
 * an extrusion can loft.
 */
export function wallPolygon(wall: Wall): [Point, Point, Point, Point] {
  const length = distance(wall.start, wall.end)
  const half = wall.thicknessMm / 2
  if (length === 0) {
    // Unreachable through `createWall`, but a renderer must never divide by
    // zero on a wall that arrived from somewhere else.
    return [wall.start, wall.start, wall.start, wall.start]
  }

  const normalX = (-(wall.end.y - wall.start.y) / length) * half
  const normalY = ((wall.end.x - wall.start.x) / length) * half
  return [
    point(wall.start.x + normalX, wall.start.y + normalY),
    point(wall.end.x + normalX, wall.end.y + normalY),
    point(wall.end.x - normalX, wall.end.y - normalY),
    point(wall.start.x - normalX, wall.start.y - normalY),
  ]
}

/**
 * Axis-aligned bounds of the DRAWN wall, thickness included.
 *
 * Deliberately not the centreline's bounds: a horizontal wall would otherwise
 * have zero height, and both the marquee and the R-tree would miss it.
 */
export function wallBounds(wall: Wall): Bounds {
  const bounds = boundsOf(wallPolygon(wall))
  return (
    bounds ?? { minX: wall.start.x, minY: wall.start.y, maxX: wall.start.x, maxY: wall.start.y }
  )
}

/** Both centreline ends — the endpoint snap's raw material. */
export const wallEndpoints = (wall: Wall): [Point, Point] => [wall.start, wall.end]

/**
 * Is `target` on this wall, within a pixel tolerance already in millimetres?
 *
 * Measured against the centreline and forgiven by half the thickness, so
 * clicking anywhere on the drawn band selects it — including a diagonal wall,
 * where a bounds test would also accept a large empty triangle beside it.
 */
export function wallHit(wall: Wall, target: Point, toleranceMm: number): boolean {
  return distanceToSegment(wallSegment(wall), target) <= wall.thicknessMm / 2 + toleranceMm
}

/**
 * Topmost wall under a point. Later walls win, because they are drawn on top —
 * clicking where two walls cross selects the one you can see.
 */
export function hitTestWalls(
  walls: readonly Wall[],
  target: Point,
  toleranceMm: number,
): string | null {
  for (let index = walls.length - 1; index >= 0; index -= 1) {
    const wall = walls[index]
    if (wall && wallHit(wall, target, toleranceMm)) return wall.id
  }
  return null
}

export type WallEnd = 'start' | 'end'

/** Moves one end of a wall, keeping everything else. */
export function moveWallEnd(wall: Wall, which: WallEnd, to: Point): Result<Wall, DomainError> {
  return createWall({
    ...wall,
    ...(which === 'start' ? { start: to } : { end: to }),
  })
}

/**
 * Sets the wall's length, holding the start and the direction — what typing a
 * number into a live dimension means.
 *
 * The start is the anchor rather than the midpoint because the user is
 * normally correcting a wall they just drew FROM somewhere: keeping the corner
 * they started at fixed is the behaviour that does not move the rest of the
 * plan out from under them.
 */
export function resizeWall(wall: Wall, lengthMm: number): Result<Wall, DomainError> {
  const rounded = mm(lengthMm)
  if (rounded < MIN_WALL_LENGTH_MM) {
    return err(
      validationError('WALL_TOO_SHORT', `A wall must be at least ${MIN_WALL_LENGTH_MM} mm long`, {
        minimumMm: MIN_WALL_LENGTH_MM,
      }),
    )
  }
  return createWall({ ...wall, end: pointAtAngle(wall.start, wallAngleDeg(wall), rounded) })
}

/** Rotates a wall about its start to an absolute bearing, keeping its length. */
export function reangleWall(wall: Wall, degrees: number): Result<Wall, DomainError> {
  return createWall({ ...wall, end: pointAtAngle(wall.start, degrees, wallLengthMm(wall)) })
}

export function translateWall(wall: Wall, deltaXMm: number, deltaYMm: number): Wall {
  return {
    ...wall,
    start: point(wall.start.x + deltaXMm, wall.start.y + deltaYMm),
    end: point(wall.end.x + deltaXMm, wall.end.y + deltaYMm),
  }
}
