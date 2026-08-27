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
import { DEFAULT_LAYER } from './wall'

/**
 * Structural elements — columns, beams, shafts, obstacles. docs/02 §3.5
 *
 * Two footprints cover all four. A COLUMN (and a shaft, and an obstacle) is a
 * rectangle placed at a point and turned; a BEAM spans two points with a
 * width. Everything downstream — bounds, hit testing, the R-tree, rendering,
 * and the extrusion in sprints 8–9 — consumes only `structuralPolygon`, so
 * adding a fifth kind never touches any of it.
 *
 * These are not walls and must never be modelled as walls: they do not bound
 * rooms, they do not host openings, and room detection has to be able to walk
 * past a column standing in the middle of a floor plate.
 */

export type PointKind = 'column' | 'shaft' | 'obstacle'
export type StructuralKind = PointKind | 'beam'

/** A rectangular footprint placed at a point and rotated about it. */
export interface PointElement {
  id: string
  kind: PointKind
  centre: Point
  /** Across the element's own X, before rotation. */
  widthMm: number
  /** Across its own Y, before rotation. */
  depthMm: number
  rotationDeg: number
  heightMm: number
  layer: string
}

/** A rectangle spanning two points — a beam, or a downstand over an opening. */
export interface SpanElement {
  id: string
  kind: 'beam'
  start: Point
  end: Point
  widthMm: number
  /** Structural depth, downward from the soffit. Carried for the 3D pass. */
  depthMm: number
  layer: string
}

export type StructuralElement = PointElement | SpanElement

export const DEFAULT_COLUMN_SIZE_MM = 300
export const DEFAULT_BEAM_WIDTH_MM = 250
export const DEFAULT_BEAM_DEPTH_MM = 500
export const DEFAULT_COLUMN_HEIGHT_MM = 3000

/** Anything smaller is a mis-click, not a member. */
export const MIN_SECTION_MM = 50
export const MIN_BEAM_LENGTH_MM = 100

export interface ColumnInput {
  id: string
  kind?: PointKind
  centre: Point
  widthMm?: number
  depthMm?: number
  rotationDeg?: number
  heightMm?: number
  layer?: string
}

export function createColumn(input: ColumnInput): Result<PointElement, DomainError> {
  const element: PointElement = {
    id: input.id,
    kind: input.kind ?? 'column',
    centre: point(input.centre.x, input.centre.y),
    widthMm: mm(input.widthMm ?? DEFAULT_COLUMN_SIZE_MM),
    depthMm: mm(input.depthMm ?? input.widthMm ?? DEFAULT_COLUMN_SIZE_MM),
    // Normalised into 0–360 so two columns that are visually identical compare
    // equal, whichever direction the user span the handle.
    rotationDeg: (((input.rotationDeg ?? 0) % 360) + 360) % 360,
    heightMm: mm(input.heightMm ?? DEFAULT_COLUMN_HEIGHT_MM),
    layer: input.layer ?? DEFAULT_LAYER,
  }

  if (element.widthMm < MIN_SECTION_MM || element.depthMm < MIN_SECTION_MM) {
    return err(
      validationError('SECTION_TOO_SMALL', `A section must be at least ${MIN_SECTION_MM} mm`, {
        minimumMm: MIN_SECTION_MM,
      }),
    )
  }
  if (element.heightMm <= 0) {
    return err(validationError('SECTION_INVALID_HEIGHT', 'Height must be positive'))
  }
  return ok(element)
}

export interface BeamInput {
  id: string
  start: Point
  end: Point
  widthMm?: number
  depthMm?: number
  layer?: string
}

export function createBeam(input: BeamInput): Result<SpanElement, DomainError> {
  const element: SpanElement = {
    id: input.id,
    kind: 'beam',
    start: point(input.start.x, input.start.y),
    end: point(input.end.x, input.end.y),
    widthMm: mm(input.widthMm ?? DEFAULT_BEAM_WIDTH_MM),
    depthMm: mm(input.depthMm ?? DEFAULT_BEAM_DEPTH_MM),
    layer: input.layer ?? DEFAULT_LAYER,
  }

  if (distance(element.start, element.end) < MIN_BEAM_LENGTH_MM) {
    return err(
      validationError('BEAM_TOO_SHORT', `A beam must be at least ${MIN_BEAM_LENGTH_MM} mm long`, {
        minimumMm: MIN_BEAM_LENGTH_MM,
      }),
    )
  }
  if (element.widthMm < MIN_SECTION_MM) {
    return err(
      validationError('SECTION_TOO_SMALL', `A section must be at least ${MIN_SECTION_MM} mm`, {
        minimumMm: MIN_SECTION_MM,
      }),
    )
  }
  return ok(element)
}

export const isBeam = (element: StructuralElement): element is SpanElement =>
  element.kind === 'beam'

export const structuralCentre = (element: StructuralElement): Point =>
  isBeam(element) ? midpoint(element.start, element.end) : element.centre

export const beamSegment = (element: SpanElement): Segment => ({
  start: element.start,
  end: element.end,
})

/**
 * The four corners, in plan space. The one derived shape everything else in
 * the planner reads — there is no second way to ask where an element is.
 */
export function structuralPolygon(element: StructuralElement): [Point, Point, Point, Point] {
  if (isBeam(element)) {
    const length = distance(element.start, element.end)
    const half = element.widthMm / 2
    if (length === 0) {
      return [element.start, element.start, element.start, element.start]
    }
    const normalX = (-(element.end.y - element.start.y) / length) * half
    const normalY = ((element.end.x - element.start.x) / length) * half
    return [
      point(element.start.x + normalX, element.start.y + normalY),
      point(element.end.x + normalX, element.end.y + normalY),
      point(element.end.x - normalX, element.end.y - normalY),
      point(element.start.x - normalX, element.start.y - normalY),
    ]
  }

  const halfWidth = element.widthMm / 2
  const halfDepth = element.depthMm / 2
  // Corners in the element's own frame, then turned into the plan's.
  return [
    cornerOf(element, -halfWidth, -halfDepth),
    cornerOf(element, halfWidth, -halfDepth),
    cornerOf(element, halfWidth, halfDepth),
    cornerOf(element, -halfWidth, halfDepth),
  ]
}

function cornerOf(element: PointElement, localX: number, localY: number): Point {
  const radians = (element.rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return point(
    element.centre.x + localX * cos - localY * sin,
    element.centre.y + localX * sin + localY * cos,
  )
}

export function structuralBounds(element: StructuralElement): Bounds {
  const centre = structuralCentre(element)
  return (
    boundsOf(structuralPolygon(element)) ?? {
      minX: centre.x,
      minY: centre.y,
      maxX: centre.x,
      maxY: centre.y,
    }
  )
}

/**
 * Whether a point is on the element.
 *
 * A rotated column is tested in its OWN frame rather than against its bounding
 * box: a 45°-turned column's box is 41 % larger than the column, and clicking
 * that empty corner would select something the user cannot see there.
 */
export function structuralHit(
  element: StructuralElement,
  target: Point,
  toleranceMm: number,
): boolean {
  if (isBeam(element)) {
    return distanceToSegment(beamSegment(element), target) <= element.widthMm / 2 + toleranceMm
  }

  const radians = (-element.rotationDeg * Math.PI) / 180
  const dx = target.x - element.centre.x
  const dy = target.y - element.centre.y
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)

  return (
    Math.abs(localX) <= element.widthMm / 2 + toleranceMm &&
    Math.abs(localY) <= element.depthMm / 2 + toleranceMm
  )
}

/** Topmost element under a point — later elements are drawn on top. */
export function hitTestStructural(
  elements: readonly StructuralElement[],
  target: Point,
  toleranceMm: number,
): string | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]
    if (element && structuralHit(element, target, toleranceMm)) return element.id
  }
  return null
}

export function translateStructural<T extends StructuralElement>(
  element: T,
  deltaXMm: number,
  deltaYMm: number,
): T {
  if (isBeam(element)) {
    return {
      ...element,
      start: point(element.start.x + deltaXMm, element.start.y + deltaYMm),
      end: point(element.end.x + deltaXMm, element.end.y + deltaYMm),
    }
  }
  return { ...element, centre: point(element.centre.x + deltaXMm, element.centre.y + deltaYMm) }
}

/**
 * Turns a point element to an absolute bearing. Beams rotate by moving their
 * ends, which is a different gesture and deliberately not this one.
 */
export const rotateColumn = (element: PointElement, degrees: number): PointElement => ({
  ...element,
  rotationDeg: ((degrees % 360) + 360) % 360,
})

/**
 * Aligns a column with a wall running through it — the placement a user wants
 * nine times out of ten, and one nobody enjoys doing by hand.
 */
export const alignColumnTo = (element: PointElement, along: Segment): PointElement =>
  rotateColumn(element, angleDegrees(along.start, along.end))

/** A beam's own bearing, for a dimension readout. */
export const beamAngleDeg = (element: SpanElement): number =>
  angleDegrees(element.start, element.end)

export const beamLengthMm = (element: SpanElement): number =>
  mm(distance(element.start, element.end))

/** Where a beam of `lengthMm` ends, drawn from `start` on `degrees`. */
export const beamEndAt = (start: Point, degrees: number, lengthMm: number): Point =>
  pointAtAngle(start, degrees, lengthMm)
