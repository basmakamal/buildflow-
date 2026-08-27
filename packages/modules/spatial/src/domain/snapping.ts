import { distance, mm, point, pointAtAngle, angleDegrees, type Point } from './geometry'

/**
 * The snapping pipeline. docs/08 §7.3
 *
 * Candidates are gathered from every enabled source, then resolved in PRIORITY
 * order: the first candidate within its own tolerance wins. Priority, not
 * proximity — a wall endpoint 10 px away must beat a grid intersection 2 px
 * away, because the user is trying to join two walls, not to land on a round
 * number. Resolving by nearest is the classic mistake and it makes corners
 * that look joined but are not.
 *
 * This file owns the RESOLUTION and the sources that need no scene: grid,
 * angle and ortho. Endpoint, perpendicular and intersection snaps arrive with
 * walls in sprints 3–4 as additional providers — they contribute candidates,
 * they do not change the rule.
 *
 * Tolerances are quoted in PIXELS and converted by the caller, because a snap
 * has to feel the same at every zoom.
 */

export const SNAP_KINDS = [
  'endpoint',
  'perpendicular',
  'intersection',
  'midpoint',
  'angle',
  'grid',
] as const
export type SnapKind = (typeof SNAP_KINDS)[number]

/** Ascending = stronger. The order docs/08 §7.3 lays out. */
const PRIORITY: Readonly<Record<SnapKind, number>> = {
  endpoint: 0,
  perpendicular: 1,
  intersection: 2,
  midpoint: 3,
  angle: 4,
  grid: 5,
}

export interface SnapCandidate {
  kind: SnapKind
  point: Point
  /** How close the pointer must be, in PLAN millimetres, for this to apply. */
  toleranceMm: number
  /** What the renderer draws as a guide — the wall or axis that produced it. */
  guide?: { from: Point; to: Point }
}

export interface SnapResult {
  point: Point
  kind: SnapKind | null
  guide?: { from: Point; to: Point }
}

export interface SnapConfig {
  grid: boolean
  /** The snap grid in millimetres — user-chosen, unlike the drawn grid. */
  gridSizeMm: number
  angle: boolean
  /** Angle increment in degrees; 45 gives the eight compass directions. */
  angleStepDeg: number
  /** Ortho constrains to horizontal/vertical only — angle snap at 90°. */
  ortho: boolean
  endpoint: boolean
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  grid: true,
  gridSizeMm: 100,
  angle: true,
  angleStepDeg: 15,
  ortho: false,
  endpoint: true,
}

/** Rounds a point to the snap grid. */
export function snapToGrid(target: Point, gridSizeMm: number): Point {
  if (gridSizeMm <= 0) return { ...target }
  return point(
    Math.round(target.x / gridSizeMm) * gridSizeMm,
    Math.round(target.y / gridSizeMm) * gridSizeMm,
  )
}

/**
 * Projects `target` onto the nearest ray of `stepDeg` from `anchor`, keeping
 * the distance the pointer actually travelled.
 *
 * Ortho is this with a 90° step, which is why there is one implementation:
 * two would drift apart the first time someone changed the rounding.
 */
export function snapToAngle(anchor: Point, target: Point, stepDeg: number): Point {
  if (stepDeg <= 0) return { ...target }
  const length = distance(anchor, target)
  if (length === 0) return { ...anchor }

  const snapped = Math.round(angleDegrees(anchor, target) / stepDeg) * stepDeg
  return pointAtAngle(anchor, snapped, length)
}

/**
 * Candidates from the sources that need nothing but the pointer.
 *
 * `anchor` is the point being drawn FROM — the previous wall end. Without one
 * there is no angle to constrain, so only the grid contributes.
 */
export function ambientCandidates(
  target: Point,
  config: SnapConfig,
  toleranceMm: number,
  anchor: Point | null,
): SnapCandidate[] {
  const candidates: SnapCandidate[] = []

  if (anchor && (config.ortho || config.angle)) {
    const step = config.ortho ? 90 : config.angleStepDeg
    const snapped = snapToAngle(anchor, target, step)
    candidates.push({
      kind: 'angle',
      point: snapped,
      // Ortho is a constraint, not a suggestion: once on, the pointer is
      // always on an axis, so its tolerance is unbounded.
      toleranceMm: config.ortho ? Number.POSITIVE_INFINITY : toleranceMm,
      guide: { from: anchor, to: snapped },
    })
  }

  if (config.grid) {
    candidates.push({
      kind: 'grid',
      point: snapToGrid(target, config.gridSizeMm),
      toleranceMm,
    })
  }

  return candidates
}

/**
 * Resolves candidates to one snapped point.
 *
 * First by priority, then — only among equals — by distance. Anything beyond
 * its own tolerance is discarded, and if nothing survives the pointer stands
 * unchanged, rounded to the millimetre the plan stores.
 */
export function resolveSnap(target: Point, candidates: readonly SnapCandidate[]): SnapResult {
  const eligible = candidates.filter(
    (candidate) => distance(target, candidate.point) <= candidate.toleranceMm,
  )
  if (eligible.length === 0) {
    return { point: point(target.x, target.y), kind: null }
  }

  const [first, ...rest] = eligible
  if (!first) return { point: point(target.x, target.y), kind: null }

  let best = first
  for (const candidate of rest) {
    const better =
      PRIORITY[candidate.kind] < PRIORITY[best.kind] ||
      (PRIORITY[candidate.kind] === PRIORITY[best.kind] &&
        distance(target, candidate.point) < distance(target, best.point))
    if (better) best = candidate
  }

  return {
    point: point(best.point.x, best.point.y),
    kind: best.kind,
    ...(best.guide ? { guide: best.guide } : {}),
  }
}

/**
 * The whole pipeline for a pointer move: ambient sources plus whatever the
 * scene contributed, resolved together.
 */
export function snap(
  target: Point,
  config: SnapConfig,
  toleranceMm: number,
  anchor: Point | null,
  sceneCandidates: readonly SnapCandidate[] = [],
): SnapResult {
  return resolveSnap(target, [
    ...sceneCandidates,
    ...ambientCandidates(target, config, toleranceMm, anchor),
  ])
}

/** Rounds a length to the nearest whole millimetre — dimension entry's guard. */
export const snapLength = (lengthMm: number): number => mm(lengthMm)
