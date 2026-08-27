/**
 * Plan geometry — integer millimetres, always. docs/18 ADR-016
 *
 * The decision this file exists to honour: coordinates are integer
 * millimetres, so two walls that meet share an EXACTLY equal endpoint. Room
 * detection then becomes a graph problem rather than a tolerance heuristic,
 * and a room cannot silently vanish from the BOQ because two corners landed
 * at 1.2000000001 and 1.1999999998 metres.
 *
 * Metres appear only at the display boundary, through the two functions at
 * the bottom of this file and nowhere else.
 *
 * Everything here is pure: no clock, no I/O, no ambient state.
 */

/** A point in plan space. Both components are integer millimetres. */
export interface Point {
  x: number
  y: number
}

export interface Segment {
  start: Point
  end: Point
}

/** Axis-aligned bounds in millimetres. `max` is inclusive. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Rounds to the nearest whole millimetre, half away from zero — the same
 * rounding Money and Quantity use, for the same reason: a value a human can
 * predict beats one that depends on the sign.
 */
export function mm(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

export const point = (x: number, y: number): Point => ({ x: mm(x), y: mm(y) })

/** Exact equality — the whole point of integer millimetres. */
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Squared length, for comparisons that never need the square root. */
export function distanceSquared(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
}

export function midpoint(a: Point, b: Point): Point {
  return point((a.x + b.x) / 2, (a.y + b.y) / 2)
}

/** Direction in degrees, 0 = east, counting counter-clockwise, 0–360. */
export function angleDegrees(from: Point, to: Point): number {
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
  return degrees < 0 ? degrees + 360 : degrees
}

/** A point at `distanceMm` from `origin` along `degrees`, rounded to mm. */
export function pointAtAngle(origin: Point, degrees: number, distanceMm: number): Point {
  const radians = (degrees * Math.PI) / 180
  return point(origin.x + Math.cos(radians) * distanceMm, origin.y + Math.sin(radians) * distanceMm)
}

/**
 * The closest point on a segment to `target`, clamped to the segment's ends.
 *
 * The basis of perpendicular snapping and of "which wall did I click": a
 * degenerate segment (both ends equal, which a half-drawn wall genuinely is)
 * returns its own start rather than dividing by zero.
 */
export function closestPointOnSegment(segment: Segment, target: Point): Point {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { ...segment.start }

  const t = ((target.x - segment.start.x) * dx + (target.y - segment.start.y) * dy) / lengthSquared
  const clamped = Math.max(0, Math.min(1, t))
  return point(segment.start.x + clamped * dx, segment.start.y + clamped * dy)
}

/** Perpendicular distance from a point to a segment, in millimetres. */
export function distanceToSegment(segment: Segment, target: Point): number {
  return distance(closestPointOnSegment(segment, target), target)
}

/**
 * The foot of the perpendicular from `target` to the INFINITE line through
 * `segment` — unclamped, so it may lie beyond either end.
 *
 * That is the point of it: perpendicular snapping asks "where would this wall
 * meet that one at a right angle", and the answer is frequently past the end
 * of the wall the user is aiming at.
 */
export function projectOntoLine(segment: Segment, target: Point): Point {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { ...segment.start }

  const t = ((target.x - segment.start.x) * dx + (target.y - segment.start.y) * dy) / lengthSquared
  return point(segment.start.x + t * dx, segment.start.y + t * dy)
}

/** Distance to the infinite line through a segment, in millimetres. */
export function distanceToLine(segment: Segment, target: Point): number {
  return distance(projectOntoLine(segment, target), target)
}

/**
 * Where the INFINITE lines through two segments cross; null when they are
 * parallel (or a segment is degenerate).
 *
 * Extended-line intersections are what let a user close a corner onto walls
 * that do not yet reach each other — the case that would otherwise force them
 * to draw long and trim.
 */
export function lineIntersection(a: Segment, b: Segment): Point | null {
  const ax = a.end.x - a.start.x
  const ay = a.end.y - a.start.y
  const bx = b.end.x - b.start.x
  const by = b.end.y - b.start.y

  const denominator = ax * by - ay * bx
  // Exactly zero for parallel lines, which integer millimetres makes a
  // reliable test rather than an epsilon comparison.
  if (denominator === 0) return null

  const t = ((b.start.x - a.start.x) * by - (b.start.y - a.start.y) * bx) / denominator
  return point(a.start.x + t * ax, a.start.y + t * ay)
}

export function boundsOf(points: readonly Point[]): Bounds | null {
  const first = points[0]
  if (!first) return null

  let minX = first.x
  let minY = first.y
  let maxX = first.x
  let maxY = first.y
  for (const candidate of points) {
    if (candidate.x < minX) minX = candidate.x
    if (candidate.y < minY) minY = candidate.y
    if (candidate.x > maxX) maxX = candidate.x
    if (candidate.y > maxY) maxY = candidate.y
  }
  return { minX, minY, maxX, maxY }
}

export function boundsOfSegment(segment: Segment): Bounds {
  return {
    minX: Math.min(segment.start.x, segment.end.x),
    minY: Math.min(segment.start.y, segment.end.y),
    maxX: Math.max(segment.start.x, segment.end.x),
    maxY: Math.max(segment.start.y, segment.end.y),
  }
}

/** Touching counts as overlapping — a marquee edge exactly on a wall selects it. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  )
}

export function boundsContainPoint(bounds: Bounds, target: Point): boolean {
  return (
    target.x >= bounds.minX &&
    target.x <= bounds.maxX &&
    target.y >= bounds.minY &&
    target.y <= bounds.maxY
  )
}

/** Grows bounds by `marginMm` on every side — hit tolerance, expressed in plan space. */
export function growBounds(bounds: Bounds, marginMm: number): Bounds {
  return {
    minX: bounds.minX - marginMm,
    minY: bounds.minY - marginMm,
    maxX: bounds.maxX + marginMm,
    maxY: bounds.maxY + marginMm,
  }
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export const boundsFromCorners = (a: Point, b: Point): Bounds => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
})

/**
 * Signed area of a polygon in mm², by the shoelace formula. Positive when the
 * points wind counter-clockwise. Room areas take the absolute value; the SIGN
 * is what tells a detected loop from a hole in sprint 6.
 */
export function signedArea(polygon: readonly Point[]): number {
  if (polygon.length < 3) return 0
  let total = 0
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) continue
    total += current.x * next.y - next.x * current.y
  }
  return total / 2
}

/**
 * Ray casting, counting crossings of a ray heading east from `target`.
 *
 * A point exactly ON an edge is deliberately not special-cased: callers ask
 * this about room interiors, where a boundary point belongs to the wall rather
 * than to either room, and any answer there is arbitrary.
 */
export function pointInPolygon(polygon: readonly Point[], target: Point): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i]
    const previous = polygon[j]
    if (!current || !previous) continue

    const straddles = current.y > target.y !== previous.y > target.y
    if (!straddles) continue

    const crossingX =
      ((previous.x - current.x) * (target.y - current.y)) / (previous.y - current.y) + current.x
    if (target.x < crossingX) inside = !inside
  }
  return inside
}

/**
 * The AREA-WEIGHTED centroid — where a room's label belongs, and what the
 * database stores so a plan can be searched by "which room is near here".
 *
 * The average of the vertices is the tempting shortcut and it lands outside
 * any L-shaped room, which is most of them once a corridor is drawn.
 */
export function polygonCentroid(polygon: readonly Point[]): Point {
  let twiceArea = 0
  let x = 0
  let y = 0

  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) continue

    const cross = current.x * next.y - next.x * current.y
    twiceArea += cross
    x += (current.x + next.x) * cross
    y += (current.y + next.y) * cross
  }

  // A degenerate polygon has no centroid worth computing; its first vertex is
  // the only honest answer.
  if (twiceArea === 0) return polygon[0] ? { ...polygon[0] } : { x: 0, y: 0 }
  return point(x / (3 * twiceArea), y / (3 * twiceArea))
}

export function polygonPerimeterMm(polygon: readonly Point[]): number {
  if (polygon.length < 2) return 0
  let total = 0
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length]
    if (next) total += distance(current, next)
  }
  return total
}

/** mm² → m², 4 dp — the display boundary, and the BOQ's input. docs/18 ADR-016 */
export function squareMmToSquareMetres(areaMm2: number): string {
  return (Math.abs(areaMm2) / 1_000_000).toFixed(4)
}

/** mm → m, 4 dp. The other half of the boundary, and the only other one. */
export function mmToMetres(valueMm: number): string {
  return (valueMm / 1000).toFixed(4)
}

/** m → mm, rounded to the whole millimetre a plan actually stores. */
export function metresToMm(metres: number): number {
  return mm(metres * 1000)
}
