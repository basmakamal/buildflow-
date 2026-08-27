import { describe, expect, it } from 'vitest'
import {
  angleDegrees,
  boundsContain,
  boundsFromCorners,
  boundsOf,
  boundsOverlap,
  closestPointOnSegment,
  distance,
  distanceToLine,
  distanceToSegment,
  lineIntersection,
  metresToMm,
  midpoint,
  mm,
  mmToMetres,
  point,
  pointAtAngle,
  pointInPolygon,
  polygonPerimeterMm,
  projectOntoLine,
  samePoint,
  signedArea,
  squareMmToSquareMetres,
} from '../src/domain/geometry'
import { applySelection, hitTest, marqueeHits, selectionBounds } from '../src/domain/selection'

/**
 * Integer millimetres, exactly. docs/18 ADR-016 — the decision that turns room
 * detection from a tolerance heuristic into a graph problem, and stops a room
 * silently vanishing from a BOQ.
 */

describe('the millimetre discipline', () => {
  it('rounds half away from zero, symmetrically', () => {
    expect(mm(1.5)).toBe(2)
    expect(mm(-1.5)).toBe(-2)
    expect(mm(2.4)).toBe(2)
  })

  it('makes shared endpoints exactly equal', () => {
    // The whole reason for the ADR: two walls meeting at the same corner.
    const a = point(1200.4, 3000.4)
    const b = point(1200.3, 3000.2)
    expect(samePoint(a, b)).toBe(true)
  })

  it('converts only at the display boundary', () => {
    expect(mmToMetres(4370)).toBe('4.3700')
    expect(metresToMm(4.37)).toBe(4370)
    expect(squareMmToSquareMetres(43_700_000)).toBe('43.7000')
  })
})

describe('measurement', () => {
  it('measures distance, midpoint and direction', () => {
    expect(distance(point(0, 0), point(3000, 4000))).toBe(5000)
    expect(midpoint(point(0, 0), point(3001, 4000))).toEqual({ x: 1501, y: 2000 })
    expect(angleDegrees(point(0, 0), point(1000, 0))).toBe(0)
    expect(angleDegrees(point(0, 0), point(0, 1000))).toBe(90)
    // Normalised to 0–360 rather than handing back a negative.
    expect(angleDegrees(point(0, 0), point(0, -1000))).toBe(270)
  })

  it('walks a given distance along a given bearing', () => {
    expect(pointAtAngle(point(0, 0), 90, 2500)).toEqual({ x: 0, y: 2500 })
  })
})

describe('projection onto a segment', () => {
  const wall = { start: point(0, 0), end: point(10_000, 0) }

  it('finds the foot of the perpendicular', () => {
    expect(closestPointOnSegment(wall, point(4000, 900))).toEqual({ x: 4000, y: 0 })
    expect(distanceToSegment(wall, point(4000, 900))).toBe(900)
  })

  it('clamps past either end, so a wall is a segment and not a line', () => {
    expect(closestPointOnSegment(wall, point(-5000, 500))).toEqual({ x: 0, y: 0 })
    expect(closestPointOnSegment(wall, point(20_000, 500))).toEqual({ x: 10_000, y: 0 })
  })

  it('survives a degenerate segment — a half-drawn wall is one', () => {
    const stub = { start: point(1000, 1000), end: point(1000, 1000) }
    expect(closestPointOnSegment(stub, point(5000, 5000))).toEqual({ x: 1000, y: 1000 })
  })
})

describe('bounds', () => {
  it('wraps a set of points, and reports nothing for none', () => {
    expect(boundsOf([point(10, 20), point(-5, 40), point(30, 0)])).toEqual({
      minX: -5,
      minY: 0,
      maxX: 30,
      maxY: 40,
    })
    expect(boundsOf([])).toBeNull()
  })

  it('treats touching as overlapping, so a marquee edge on a wall selects it', () => {
    const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const b = { minX: 100, minY: 100, maxX: 200, maxY: 200 }
    expect(boundsOverlap(a, b)).toBe(true)
    expect(boundsOverlap(a, { minX: 101, minY: 101, maxX: 200, maxY: 200 })).toBe(false)
  })

  it('normalises corners dragged in any direction', () => {
    expect(boundsFromCorners(point(200, 300), point(0, 100))).toEqual({
      minX: 0,
      minY: 100,
      maxX: 200,
      maxY: 300,
    })
  })

  it('distinguishes containment from overlap', () => {
    const outer = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    expect(boundsContain(outer, { minX: 10, minY: 10, maxX: 90, maxY: 90 })).toBe(true)
    expect(boundsContain(outer, { minX: 10, minY: 10, maxX: 110, maxY: 90 })).toBe(false)
  })
})

describe('polygons', () => {
  // A 5 m × 4 m room, counter-clockwise in screen coordinates.
  const room = [point(0, 0), point(5000, 0), point(5000, 4000), point(0, 4000)]

  it('computes area by the shoelace formula, in m² at the boundary', () => {
    expect(Math.abs(signedArea(room))).toBe(20_000_000)
    expect(squareMmToSquareMetres(signedArea(room))).toBe('20.0000')
  })

  it('signs the area by winding — how a loop is told from a hole', () => {
    expect(signedArea(room)).toBeGreaterThan(0)
    expect(signedArea([...room].reverse())).toBeLessThan(0)
  })

  it('measures the perimeter a skirting rule will read', () => {
    expect(polygonPerimeterMm(room)).toBe(18_000)
  })

  it('reports nothing for a degenerate polygon', () => {
    expect(signedArea([point(0, 0), point(1000, 0)])).toBe(0)
  })
})

describe('selection', () => {
  const entities = [
    { id: 'wall-a', bounds: { minX: 0, minY: 0, maxX: 5000, maxY: 100 } },
    { id: 'wall-b', bounds: { minX: 4900, minY: 0, maxX: 5000, maxY: 4000 } },
    { id: 'wall-c', bounds: { minX: 20_000, minY: 20_000, maxX: 25_000, maxY: 20_100 } },
  ]

  it('replaces, adds and toggles', () => {
    expect([...applySelection(new Set(['x']), ['a', 'b'], 'replace')]).toEqual(['a', 'b'])
    expect([...applySelection(new Set(['x']), ['a'], 'add')]).toEqual(['x', 'a'])
    expect([...applySelection(new Set(['x', 'a']), ['a'], 'toggle')]).toEqual(['x'])
  })

  it('window selects only what is fully inside; crossing takes what it touches', () => {
    const marquee = { minX: -100, minY: -100, maxX: 5100, maxY: 200 }
    // Dragging right: wall-b sticks out below, so it is not caught.
    expect(marqueeHits(entities, marquee, 'right')).toEqual(['wall-a'])
    // Dragging left: touching is enough.
    expect(marqueeHits(entities, marquee, 'left')).toEqual(['wall-a', 'wall-b'])
  })

  it('frames the selection, and nothing when none is selected', () => {
    expect(selectionBounds(entities, new Set(['wall-a', 'wall-b']))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 5000,
      maxY: 4000,
    })
    expect(selectionBounds(entities, new Set())).toBeNull()
  })

  it('hit-tests topmost first, because that is the one you can see', () => {
    // Both walls own the corner at 5000,0 — the later-drawn one wins.
    expect(hitTest(entities, { x: 4950, y: 50 }, 0)).toBe('wall-b')
    expect(hitTest(entities, { x: 9000, y: 50 }, 0)).toBeNull()
    // Tolerance widens the target without moving it.
    expect(hitTest(entities, { x: 9000, y: 50 }, 4100)).toBe('wall-b')
  })
})

describe('infinite lines', () => {
  const north = { start: point(0, 0), end: point(3000, 0) }
  const east = { start: point(6000, 2000), end: point(6000, 8000) }

  it('projects past the end of a segment, unlike the clamped version', () => {
    // The perpendicular from (6000, 4000) onto the north wall's LINE lands at
    // x = 6000, twice as far as the wall actually reaches.
    expect(projectOntoLine(north, point(6000, 4000))).toEqual({ x: 6000, y: 0 })
    expect(closestPointOnSegment(north, point(6000, 4000))).toEqual({ x: 3000, y: 0 })
  })

  it('measures distance to the line, not to the nearer end', () => {
    expect(distanceToLine(north, point(6000, 250))).toBe(250)
    expect(distanceToSegment(north, point(6000, 250))).toBeCloseTo(3010.4, 1)
  })

  it('crosses two extended lines that never touch as segments', () => {
    expect(lineIntersection(north, east)).toEqual({ x: 6000, y: 0 })
  })

  it('returns null for parallel lines rather than an enormous coordinate', () => {
    const parallel = { start: point(0, 3000), end: point(3000, 3000) }

    expect(lineIntersection(north, parallel)).toBeNull()
    // Integer millimetres make this an exact test, not an epsilon one.
    expect(lineIntersection(north, { start: point(0, 0), end: point(1, 0) })).toBeNull()
  })

  it('treats a degenerate segment as its own start instead of dividing by zero', () => {
    const nothing = { start: point(500, 500), end: point(500, 500) }

    expect(projectOntoLine(nothing, point(0, 0))).toEqual({ x: 500, y: 500 })
    expect(lineIntersection(nothing, north)).toBeNull()
  })
})

describe('point in polygon', () => {
  // An L, so that a point outside the notch is still inside the bounding box —
  // the case a bounds test gets wrong and this one must not.
  const shape = [
    point(0, 0),
    point(6000, 0),
    point(6000, 2000),
    point(3000, 2000),
    point(3000, 4000),
    point(0, 4000),
  ]

  it('accepts the inside and rejects the notch', () => {
    expect(pointInPolygon(shape, point(1000, 1000))).toBe(true)
    expect(pointInPolygon(shape, point(1000, 3000))).toBe(true)
    expect(pointInPolygon(shape, point(5000, 3000))).toBe(false)
  })

  it('rejects points beyond the shape entirely', () => {
    expect(pointInPolygon(shape, point(-1, 1000))).toBe(false)
    expect(pointInPolygon(shape, point(9000, 1000))).toBe(false)
  })

  it('is unaffected by winding direction', () => {
    expect(pointInPolygon([...shape].reverse(), point(1000, 1000))).toBe(true)
  })
})
