import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import {
  boundsOf,
  mm,
  point,
  pointAtAngle,
  type Bounds,
  type Point,
  type Segment,
} from './geometry'
import { closestPointOnSegment, distance } from './geometry'
import { wallAngleDeg, wallLengthMm, wallSegment, type Wall } from './wall'

/**
 * Openings — doors and windows. docs/02 §3.5
 *
 * An opening is HOSTED: it stores an offset along its wall's centreline, not a
 * position in the plan. That is the whole design. Move the wall, drag its
 * endpoint, retype its length — the door stays where it belongs, because the
 * only coordinate it ever had was relative to the wall. Storing absolute
 * points instead would mean re-deriving every host relationship after every
 * edit, and doors would drift off their walls the first time one was resized.
 *
 * Invariants, from docs/02 §3.5:
 *   · an opening lies entirely within its host wall — 0 ≤ offset and
 *     offset + width ≤ wallLength;
 *   · two openings on the same wall may not overlap;
 *   · width is at least a door a person can walk through.
 */

export type OpeningKind = 'door' | 'window'

export interface Opening {
  id: string
  wallId: string
  kind: OpeningKind
  /** Millimetres along the host centreline, from the wall's start to the opening's start. */
  offsetMm: number
  widthMm: number
  /** Structural opening height, floor to head for a door, sill to head for a window. */
  heightMm: number
  /** Sill height above finished floor. Zero for a door, by definition. */
  sillMm: number
}

/** Regional defaults: a 900 mm leaf, a 1200 mm window on a 900 mm sill. */
export const DEFAULT_DOOR_WIDTH_MM = 900
export const DEFAULT_DOOR_HEIGHT_MM = 2100
export const DEFAULT_WINDOW_WIDTH_MM = 1200
export const DEFAULT_WINDOW_HEIGHT_MM = 1200
export const DEFAULT_WINDOW_SILL_MM = 900

/** Narrower than this is not an opening anyone builds — it is a mis-drag. */
export const MIN_OPENING_WIDTH_MM = 300

export interface OpeningInput {
  id: string
  wallId: string
  kind: OpeningKind
  offsetMm: number
  widthMm?: number
  heightMm?: number
  sillMm?: number
}

const defaultsFor = (kind: OpeningKind) =>
  kind === 'door'
    ? { widthMm: DEFAULT_DOOR_WIDTH_MM, heightMm: DEFAULT_DOOR_HEIGHT_MM, sillMm: 0 }
    : {
        widthMm: DEFAULT_WINDOW_WIDTH_MM,
        heightMm: DEFAULT_WINDOW_HEIGHT_MM,
        sillMm: DEFAULT_WINDOW_SILL_MM,
      }

/**
 * Creates an opening on a wall, checked against that wall and its neighbours.
 *
 * `siblings` are the openings ALREADY on this wall. They are a parameter
 * rather than something looked up, because this module knows nothing about
 * where a plan is stored — and passing them makes the overlap rule impossible
 * to forget at a call site.
 */
export function createOpening(
  input: OpeningInput,
  wall: Wall,
  siblings: readonly Opening[] = [],
): Result<Opening, DomainError> {
  if (input.wallId !== wall.id) {
    return err(
      validationError('OPENING_WALL_MISMATCH', 'The opening does not belong to the given wall', {
        openingWall: input.wallId,
        wall: wall.id,
      }),
    )
  }

  const fallback = defaultsFor(input.kind)
  const opening: Opening = {
    id: input.id,
    wallId: input.wallId,
    kind: input.kind,
    offsetMm: mm(input.offsetMm),
    widthMm: mm(input.widthMm ?? fallback.widthMm),
    heightMm: mm(input.heightMm ?? fallback.heightMm),
    sillMm: mm(input.sillMm ?? fallback.sillMm),
  }

  if (opening.widthMm < MIN_OPENING_WIDTH_MM) {
    return err(
      validationError(
        'OPENING_TOO_NARROW',
        `An opening must be at least ${MIN_OPENING_WIDTH_MM} mm`,
        {
          minimumMm: MIN_OPENING_WIDTH_MM,
        },
      ),
    )
  }
  if (opening.heightMm <= 0) {
    return err(validationError('OPENING_INVALID_HEIGHT', 'Opening height must be positive'))
  }
  if (opening.sillMm < 0) {
    return err(validationError('OPENING_INVALID_SILL', 'A sill cannot be below the floor'))
  }

  const wallLength = wallLengthMm(wall)
  if (opening.offsetMm < 0 || opening.offsetMm + opening.widthMm > wallLength) {
    return err(
      validationError('OPENING_OUTSIDE_WALL', 'An opening must lie entirely within its wall', {
        offsetMm: opening.offsetMm,
        widthMm: opening.widthMm,
        wallLengthMm: wallLength,
      }),
    )
  }

  const clash = siblings.find(
    (sibling) => sibling.id !== opening.id && openingsOverlap(sibling, opening),
  )
  if (clash) {
    return err(
      validationError('OPENING_OVERLAPS', 'Two openings on one wall may not overlap', {
        other: clash.id,
      }),
    )
  }

  return ok(opening)
}

/** Start and end of the opening along the host centreline, in millimetres. */
export const openingRangeMm = (opening: Opening): [number, number] => [
  opening.offsetMm,
  opening.offsetMm + opening.widthMm,
]

export const openingCentreMm = (opening: Opening): number => opening.offsetMm + opening.widthMm / 2

/** Touching is allowed; sharing any length is not — two doors may sit jamb to jamb. */
export function openingsOverlap(a: Opening, b: Opening): boolean {
  if (a.wallId !== b.wallId) return false
  const [aStart, aEnd] = openingRangeMm(a)
  const [bStart, bEnd] = openingRangeMm(b)
  return aStart < bEnd && bStart < aEnd
}

/** The opening's span, as two points on the host wall's centreline. */
export function openingSegment(wall: Wall, opening: Opening): Segment {
  const heading = wallAngleDeg(wall)
  return {
    start: pointAtAngle(wall.start, heading, opening.offsetMm),
    end: pointAtAngle(wall.start, heading, opening.offsetMm + opening.widthMm),
  }
}

export const openingCentre = (wall: Wall, opening: Opening): Point =>
  pointAtAngle(wall.start, wallAngleDeg(wall), openingCentreMm(opening))

/**
 * The rectangle the opening occupies — its width along the wall, the wall's
 * full thickness across it. What the renderer knocks out of the wall, and what
 * the 3D extrusion will subtract in sprints 8–9.
 */
export function openingPolygon(wall: Wall, opening: Opening): [Point, Point, Point, Point] {
  const segment = openingSegment(wall, opening)
  const heading = wallAngleDeg(wall)
  const half = wall.thicknessMm / 2
  const normal = pointAtAngle({ x: 0, y: 0 }, heading + 90, half)

  return [
    point(segment.start.x + normal.x, segment.start.y + normal.y),
    point(segment.end.x + normal.x, segment.end.y + normal.y),
    point(segment.end.x - normal.x, segment.end.y - normal.y),
    point(segment.start.x - normal.x, segment.start.y - normal.y),
  ]
}

export function openingBounds(wall: Wall, opening: Opening): Bounds {
  const bounds = boundsOf(openingPolygon(wall, opening))
  return (
    bounds ?? { minX: wall.start.x, minY: wall.start.y, maxX: wall.start.x, maxY: wall.start.y }
  )
}

/**
 * The offset that CENTRES an opening of `widthMm` on the point under the
 * cursor, clamped so it stays inside the wall.
 *
 * Clamping rather than rejecting is deliberate: a user aiming a door at the
 * end of a wall means "as close to the corner as it will go", and refusing the
 * click teaches them nothing.
 */
export function centreOpeningAt(wall: Wall, target: Point, widthMm: number): number {
  const along = distance(wall.start, closestPointOnSegment(wallSegment(wall), target))
  const limit = Math.max(0, wallLengthMm(wall) - widthMm)
  return mm(Math.min(limit, Math.max(0, along - widthMm / 2)))
}

/** Slides an opening along its wall. */
export function moveOpening(
  wall: Wall,
  opening: Opening,
  offsetMm: number,
  siblings: readonly Opening[] = [],
): Result<Opening, DomainError> {
  return createOpening({ ...opening, offsetMm }, wall, siblings)
}

/** Resizes an opening about its own centre, which is how a jamb drag reads. */
export function resizeOpening(
  wall: Wall,
  opening: Opening,
  widthMm: number,
  siblings: readonly Opening[] = [],
): Result<Opening, DomainError> {
  const centre = openingCentreMm(opening)
  return createOpening(
    { ...opening, widthMm, offsetMm: mm(centre - mm(widthMm) / 2) },
    wall,
    siblings,
  )
}

/** The openings hosted on one wall, in document order. */
export const openingsOn = (openings: readonly Opening[], wallId: string): Opening[] =>
  openings.filter((opening) => opening.wallId === wallId)

/**
 * Whether a point lands on an opening, within a tolerance already in
 * millimetres. Measured across the wall's thickness, like the wall itself.
 */
export function openingHit(
  wall: Wall,
  opening: Opening,
  target: Point,
  toleranceMm: number,
): boolean {
  const segment = openingSegment(wall, opening)
  const nearest = closestPointOnSegment(segment, target)
  return distance(nearest, target) <= wall.thicknessMm / 2 + toleranceMm
}
