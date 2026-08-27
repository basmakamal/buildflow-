import { describe, expect, it } from 'vitest'
import { wallSnapCandidates } from '../src/domain/wall-snapping'
import { DEFAULT_SNAP_CONFIG, resolveSnap, snap } from '../src/domain/snapping'
import { SpatialIndex } from '../src/domain/spatial-index'
import { createWall, wallBounds, type Wall } from '../src/domain/wall'
import { point } from '../src/domain/geometry'

/**
 * Scene snapping, and the rule the whole pipeline turns on: PRIORITY beats
 * proximity. An endpoint slightly further from the cursor must win over a grid
 * intersection right under it, because the user is joining two walls — and a
 * corner that merely looks joined is the defect that breaks room detection two
 * sprints later.
 */

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  createWall({ id, start: point(x1, y1), end: point(x2, y2) }).unwrap()

const indexOf = (walls: readonly Wall[]) =>
  SpatialIndex.of(walls.map((item) => ({ id: item.id, bounds: wallBounds(item) })))

/** 1 mm per pixel — so a 12 px endpoint tolerance is 12 mm, and easy to read. */
const MM_PER_PX = 1

const candidatesFor = (
  walls: readonly Wall[],
  target: ReturnType<typeof point>,
  anchor: ReturnType<typeof point> | null = null,
  config = DEFAULT_SNAP_CONFIG,
  mmPerPx = MM_PER_PX,
) => wallSnapCandidates(target, walls, indexOf(walls), config, { mmPerPx, anchor })

describe('endpoint and midpoint', () => {
  const walls = [wall('north', 0, 0, 6000, 0)]

  it('offers an endpoint within 12 px of the cursor', () => {
    const kinds = candidatesFor(walls, point(6008, 4)).map((candidate) => candidate.kind)

    expect(kinds).toContain('endpoint')
  })

  it('offers nothing once the cursor is past the tolerance', () => {
    expect(candidatesFor(walls, point(6040, 0))).toEqual([])
  })

  it('offers the midpoint of a wall', () => {
    const midpointCandidate = candidatesFor(walls, point(3004, 3)).find(
      (candidate) => candidate.kind === 'midpoint',
    )

    expect(midpointCandidate?.point).toEqual({ x: 3000, y: 0 })
  })

  it('goes silent when object snapping is switched off', () => {
    const off = { ...DEFAULT_SNAP_CONFIG, endpoint: false }

    expect(candidatesFor(walls, point(6000, 0), null, off)).toEqual([])
  })
})

describe('perpendicular', () => {
  const walls = [wall('east', 6000, -2000, 6000, 6000)]

  it('offers the foot of the perpendicular from the ANCHOR, not from the cursor', () => {
    // Drawing from (0, 1000): the perpendicular onto a vertical wall lands at
    // (6000, 1000), and the cursor is 5 mm away from it.
    const found = candidatesFor(walls, point(6003, 1004), point(0, 1000)).find(
      (candidate) => candidate.kind === 'perpendicular',
    )

    expect(found?.point).toEqual({ x: 6000, y: 1000 })
  })

  it('means nothing before there is something to draw from', () => {
    const kinds = candidatesFor(walls, point(6003, 1004)).map((candidate) => candidate.kind)

    expect(kinds).not.toContain('perpendicular')
  })
})

describe('intersection of extended lines', () => {
  // Two walls that stop short of each other — the case that would otherwise
  // force the user to draw long and trim.
  const walls = [wall('north', 0, 0, 3000, 0), wall('east', 6000, 2000, 6000, 8000)]

  /** A realistic whole-room zoom: 20 mm per pixel, so both walls are on screen. */
  const ZOOMED_OUT = 20

  it('offers the crossing of the extensions', () => {
    const found = candidatesFor(walls, point(6002, 3), null, DEFAULT_SNAP_CONFIG, ZOOMED_OUT).find(
      (candidate) => candidate.kind === 'intersection',
    )

    expect(found?.point).toEqual({ x: 6000, y: 0 })
  })

  it('ignores a wall too far off screen to be what the user is aiming at', () => {
    // Same geometry, zoomed in to 1 mm per pixel: the north wall is now three
    // thousand pixels away, and extending it to meet the cursor would be a
    // snap out of nowhere.
    const kinds = candidatesFor(walls, point(6002, 3)).map((candidate) => candidate.kind)

    expect(kinds).not.toContain('intersection')
  })

  it('offers nothing for parallel walls', () => {
    const parallel = [wall('a', 0, 0, 6000, 0), wall('b', 0, 3000, 6000, 3000)]
    const kinds = candidatesFor(parallel, point(3000, 1500), null, DEFAULT_SNAP_CONFIG, 20).map(
      (candidate) => candidate.kind,
    )

    expect(kinds).not.toContain('intersection')
  })
})

describe('resolution against the ambient sources', () => {
  const walls = [wall('north', 0, 0, 6000, 0)]

  it('lets an endpoint beat a grid intersection that is closer', () => {
    // The grid would take the cursor to (6000, 0)'s neighbour at 5990 → 6000…
    // so put the endpoint deliberately OFF-grid to make the contest real.
    const offGrid = [wall('north', 0, 0, 5987, 0)]
    const result = snap(
      point(5992, 2),
      { ...DEFAULT_SNAP_CONFIG, gridSizeMm: 100 },
      12 * MM_PER_PX,
      null,
      candidatesFor(offGrid, point(5992, 2)),
    )

    expect(result.kind).toBe('endpoint')
    expect(result.point).toEqual({ x: 5987, y: 0 })
  })

  it('falls through to the grid when no wall is near', () => {
    const target = point(2306, 1194)
    const result = snap(
      target,
      { ...DEFAULT_SNAP_CONFIG, gridSizeMm: 100 },
      12 * MM_PER_PX,
      null,
      candidatesFor(walls, target),
    )

    expect(result.kind).toBe('grid')
    expect(result.point).toEqual({ x: 2300, y: 1200 })
  })

  it('prefers an endpoint over the midpoint of the same wall', () => {
    // A 20 mm wall: both candidates are within tolerance of the centre.
    const stub = [wall('stub', 0, 0, 20, 0)]
    const result = resolveSnap(point(10, 0), candidatesFor(stub, point(10, 0)))

    expect(result.kind).toBe('endpoint')
  })
})

describe('exclusions', () => {
  it('never snaps a wall to itself', () => {
    const walls = [wall('dragged', 0, 0, 6000, 0)]
    const candidates = wallSnapCandidates(
      point(6000, 0),
      walls,
      indexOf(walls),
      DEFAULT_SNAP_CONFIG,
      { mmPerPx: MM_PER_PX, anchor: null, exclude: new Set(['dragged']) },
    )

    expect(candidates).toEqual([])
  })
})
