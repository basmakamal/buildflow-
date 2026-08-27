import {
  distance,
  distanceToLine,
  lineIntersection,
  midpoint,
  projectOntoLine,
  type Point,
} from './geometry'
import type { SnapCandidate, SnapConfig } from './snapping'
import type { SpatialIndex } from './spatial-index'
import { wallSegment, type Wall } from './wall'

/**
 * Scene snap candidates — the sources that need the walls. docs/08 §7.3
 *
 * `snapping.ts` owns the RESOLUTION rule and the ambient sources (grid, angle,
 * ortho). This file adds the four that read the drawing, and it adds nothing
 * else: they are candidates like any other, resolved by the same priority.
 *
 * Tolerances are quoted in PIXELS, exactly as docs/08 §7.3 states them, and
 * converted here with the caller's `mmPerPx`. A snap that was specified in
 * millimetres would be unusably tight zoomed out and unusably loose zoomed in.
 */

export const SNAP_TOLERANCE_PX = {
  endpoint: 12,
  midpoint: 10,
  perpendicular: 8,
  intersection: 8,
} as const

/**
 * How far from the cursor a wall may be and still contribute an EXTENDED-line
 * candidate.
 *
 * Perpendicular and intersection snaps read a wall's infinite line, and an
 * infinite line has no bounds an R-tree can index. Without a bound, every wall
 * in the plan would be a candidate on every pointer move. Half a screen is the
 * honest compromise: a wall the user cannot see is not one they are aiming at.
 */
const NEIGHBOURHOOD_PX = 400

export interface WallSnapOptions {
  /** Plan millimetres per screen pixel — `pxToMm(viewport, 1)`. */
  mmPerPx: number
  /** The point being drawn FROM. Perpendicular snapping needs one. */
  anchor: Point | null
  /** Walls to ignore — a wall being dragged must not snap to itself. */
  exclude?: ReadonlySet<string>
}

const NOTHING: ReadonlySet<string> = new Set()

/**
 * Every wall-derived candidate near `target`, unresolved.
 *
 * Gated by `config.endpoint`, which docs/08 §7.2 defines as the object-snap
 * switch: with it off the planner still snaps to the grid and to angles, but
 * stops reading the drawing — the toggle a user reaches for when the existing
 * geometry keeps stealing the point they are trying to place.
 */
export function wallSnapCandidates(
  target: Point,
  walls: readonly Wall[],
  index: SpatialIndex,
  config: SnapConfig,
  options: WallSnapOptions,
): SnapCandidate[] {
  if (!config.endpoint || walls.length === 0) return []

  const exclude = options.exclude ?? NOTHING
  const tolerance = {
    endpoint: SNAP_TOLERANCE_PX.endpoint * options.mmPerPx,
    midpoint: SNAP_TOLERANCE_PX.midpoint * options.mmPerPx,
    perpendicular: SNAP_TOLERANCE_PX.perpendicular * options.mmPerPx,
    intersection: SNAP_TOLERANCE_PX.intersection * options.mmPerPx,
  }

  const byId = new Map(walls.map((wall) => [wall.id, wall]))
  const neighbourhood = index
    .near(target, NEIGHBOURHOOD_PX * options.mmPerPx)
    .filter((id) => !exclude.has(id))
    .map((id) => byId.get(id))
    .filter((wall): wall is Wall => wall !== undefined)

  const candidates: SnapCandidate[] = []

  for (const wall of neighbourhood) {
    const segment = wallSegment(wall)

    for (const endpoint of [wall.start, wall.end]) {
      if (distance(target, endpoint) <= tolerance.endpoint) {
        candidates.push({
          kind: 'endpoint',
          point: endpoint,
          toleranceMm: tolerance.endpoint,
          guide: wallGuide(wall),
        })
      }
    }

    const centre = midpoint(wall.start, wall.end)
    if (distance(target, centre) <= tolerance.midpoint) {
      candidates.push({
        kind: 'midpoint',
        point: centre,
        toleranceMm: tolerance.midpoint,
        guide: wallGuide(wall),
      })
    }

    // Perpendicular is a relationship between the wall being DRAWN and an
    // existing one, so it means nothing until there is something to draw from.
    if (options.anchor) {
      const foot = projectOntoLine(segment, options.anchor)
      if (distance(target, foot) <= tolerance.perpendicular) {
        candidates.push({
          kind: 'perpendicular',
          point: foot,
          toleranceMm: tolerance.perpendicular,
          guide: { from: options.anchor, to: foot },
        })
      }
    }
  }

  // An intersection within tolerance of the cursor lies on both lines, so both
  // lines must pass within tolerance of the cursor. Filtering on that first
  // turns an O(n²) pairing into one over the handful of lines actually under
  // the pointer.
  const crossing = neighbourhood.filter(
    (wall) => distanceToLine(wallSegment(wall), target) <= tolerance.intersection,
  )
  for (let i = 0; i < crossing.length; i += 1) {
    for (let j = i + 1; j < crossing.length; j += 1) {
      const first = crossing[i]
      const second = crossing[j]
      if (!first || !second) continue

      const crossPoint = lineIntersection(wallSegment(first), wallSegment(second))
      if (!crossPoint || distance(target, crossPoint) > tolerance.intersection) continue

      candidates.push({
        kind: 'intersection',
        point: crossPoint,
        toleranceMm: tolerance.intersection,
        // The guide shows the EXTENSION that produced the point, because the
        // intersection is frequently past both walls' visible ends and would
        // otherwise look like the snap came from nowhere.
        guide: { from: nearestEnd(first, crossPoint), to: crossPoint },
      })
    }
  }

  return candidates
}

const nearestEnd = (wall: Wall, target: Point): Point =>
  distance(wall.start, target) <= distance(wall.end, target) ? wall.start : wall.end

/** The wall itself, as a guide — it names which wall a snap came from. */
const wallGuide = (wall: Wall): { from: Point; to: Point } => ({ from: wall.start, to: wall.end })
