import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALL_THICKNESS_MM,
  MIN_WALL_LENGTH_MM,
  createWall,
  hitTestWalls,
  moveWallEnd,
  reangleWall,
  resizeWall,
  translateWall,
  wallAngleDeg,
  wallBounds,
  wallLengthMm,
  wallPolygon,
  type Wall,
} from '../src/domain/wall'
import { point } from '../src/domain/geometry'

/**
 * A wall is a centreline plus a thickness. These tests pin the two things that
 * follow from that: the drawn quad is DERIVED (so corners never drift out of
 * agreement with the topology), and no edit can produce a wall the invariants
 * forbid — because a zero-length wall is a degenerate node that would break
 * room detection long after the click that created it.
 */

const wallAt = (start: [number, number], end: [number, number], thicknessMm = 200): Wall =>
  createWall({
    id: 'w1',
    start: point(start[0], start[1]),
    end: point(end[0], end[1]),
    thicknessMm,
  }).unwrap()

describe('creating a wall', () => {
  it('keeps integer millimetres and fills in the regional defaults', () => {
    const wall = createWall({ id: 'w', start: point(0.4, 0), end: point(5000.6, 0) }).unwrap()

    expect(wall.start).toEqual({ x: 0, y: 0 })
    expect(wall.end).toEqual({ x: 5001, y: 0 })
    expect(wall.thicknessMm).toBe(DEFAULT_WALL_THICKNESS_MM)
    expect(wall.layer).toBe('default')
  })

  it('refuses a wall shorter than the minimum — the click that wandered', () => {
    const result = createWall({
      id: 'w',
      start: point(0, 0),
      end: point(MIN_WALL_LENGTH_MM - 1, 0),
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('WALL_TOO_SHORT')
  })

  it('refuses a non-positive thickness or height', () => {
    const flat = createWall({ id: 'w', start: point(0, 0), end: point(1000, 0), thicknessMm: 0 })
    const short = createWall({ id: 'w', start: point(0, 0), end: point(1000, 0), heightMm: -1 })

    expect(flat.isErr()).toBe(true)
    expect(short.isErr()).toBe(true)
  })
})

describe('derived geometry', () => {
  it('offsets the quad half a thickness either side of the centreline', () => {
    const polygon = wallPolygon(wallAt([0, 0], [5000, 0], 200))

    expect(polygon).toEqual([
      { x: 0, y: 100 },
      { x: 5000, y: 100 },
      { x: 5000, y: -100 },
      { x: 0, y: -100 },
    ])
  })

  it('bounds the DRAWN wall, so a horizontal wall is not zero-height', () => {
    // The centreline's bounds would be 0 mm tall, and both the marquee and the
    // R-tree would then miss a perfectly ordinary wall.
    expect(wallBounds(wallAt([0, 0], [5000, 0], 200))).toEqual({
      minX: 0,
      minY: -100,
      maxX: 5000,
      maxY: 100,
    })
  })

  it('measures length and bearing from the centreline', () => {
    const wall = wallAt([0, 0], [3000, 4000])

    expect(wallLengthMm(wall)).toBe(5000)
    expect(Math.round(wallAngleDeg(wall))).toBe(53)
  })
})

describe('editing', () => {
  it('resizes from the start, holding the direction — what typing a length means', () => {
    const resized = resizeWall(wallAt([1000, 1000], [4000, 1000]), 5500).unwrap()

    expect(resized.start).toEqual({ x: 1000, y: 1000 })
    expect(resized.end).toEqual({ x: 6500, y: 1000 })
    expect(wallLengthMm(resized)).toBe(5500)
  })

  it('rejects a resize below the minimum instead of collapsing the wall', () => {
    expect(resizeWall(wallAt([0, 0], [4000, 0]), 2).isErr()).toBe(true)
  })

  it('rotates about the start, keeping the length', () => {
    const turned = reangleWall(wallAt([0, 0], [5000, 0]), 90).unwrap()

    expect(turned.end).toEqual({ x: 0, y: 5000 })
    expect(wallLengthMm(turned)).toBe(5000)
  })

  it('refuses to drag an endpoint onto its own opposite', () => {
    const result = moveWallEnd(wallAt([0, 0], [5000, 0]), 'end', point(0, 0))

    expect(result.isErr()).toBe(true)
  })

  it('translates both ends together', () => {
    const moved = translateWall(wallAt([0, 0], [5000, 0]), 100, -50)

    expect(moved.start).toEqual({ x: 100, y: -50 })
    expect(moved.end).toEqual({ x: 5100, y: -50 })
  })
})

describe('hit testing', () => {
  const walls = [
    { ...wallAt([0, 0], [5000, 0], 200), id: 'lower' },
    { ...wallAt([0, 0], [5000, 5000], 200), id: 'diagonal' },
  ]

  it('accepts a point on the drawn band, forgiven by the tolerance', () => {
    // 100 mm off the centreline is still inside a 200 mm wall.
    expect(hitTestWalls(walls, point(2500, 90), 0)).toBe('lower')
    // 130 mm off is outside the band but inside a 50 mm tolerance.
    expect(hitTestWalls(walls, point(2500, 130), 50)).toBe('lower')
    expect(hitTestWalls(walls, point(2500, 400), 50)).toBeNull()
  })

  it('measures against the centreline, not the bounds', () => {
    // Deep inside the diagonal wall's bounding box, but nowhere near the wall.
    expect(hitTestWalls([walls[1] as Wall], point(4500, 500), 50)).toBeNull()
  })

  it('returns the topmost wall where two cross', () => {
    expect(hitTestWalls(walls, point(0, 0), 10)).toBe('diagonal')
  })
})
