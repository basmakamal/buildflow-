import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SNAP_CONFIG,
  ambientCandidates,
  resolveSnap,
  snap,
  snapToAngle,
  snapToGrid,
  type SnapCandidate,
} from '../src/domain/snapping'
import { point } from '../src/domain/geometry'

/**
 * The rule that makes snapping feel right: PRIORITY beats proximity. A wall
 * endpoint slightly further away must win over a grid intersection right under
 * the cursor, because the user is joining two walls, not landing on a round
 * number — and corners that merely look joined are the bug this prevents.
 */

const config = { ...DEFAULT_SNAP_CONFIG, gridSizeMm: 100 }

describe('grid', () => {
  it('rounds to the nearest grid intersection', () => {
    expect(snapToGrid(point(1234, 5678), 100)).toEqual({ x: 1200, y: 5700 })
    expect(snapToGrid(point(-1234, -5678), 100)).toEqual({ x: -1200, y: -5700 })
  })

  it('leaves the point alone when the grid is off', () => {
    expect(snapToGrid(point(1234, 5678), 0)).toEqual({ x: 1234, y: 5678 })
  })
})

describe('angle', () => {
  const anchor = point(0, 0)

  it('projects onto the NEAREST ray, keeping the travelled distance', () => {
    // 7° off horizontal is nearer to 0° than to 15°, so it collapses flat…
    const flat = snapToAngle(anchor, point(1000, 123), 15)
    expect(flat.y).toBe(0)
    // …and the length the pointer travelled survives the projection.
    expect(flat.x).toBe(1008)

    // …while 10° is nearer to 15°, and rounds up onto that ray instead.
    const raised = snapToAngle(anchor, point(1000, 176), 15)
    expect(raised).toEqual({ x: 981, y: 263 })
  })

  it('gives the eight compass directions at 45°', () => {
    expect(snapToAngle(anchor, point(1000, 900), 45)).toEqual({ x: 951, y: 951 })
  })

  it('ortho is the same rule at 90°', () => {
    // 20° above horizontal collapses to due east.
    const snapped = snapToAngle(anchor, point(1000, 364), 90)
    expect(snapped).toEqual({ x: 1064, y: 0 })
  })

  it('returns the anchor for a zero-length drag rather than dividing by zero', () => {
    expect(snapToAngle(anchor, point(0, 0), 15)).toEqual({ x: 0, y: 0 })
  })
})

describe('resolution', () => {
  const target = point(1010, 1010)

  it('prefers an endpoint over a nearer grid point', () => {
    const candidates: SnapCandidate[] = [
      { kind: 'grid', point: point(1000, 1000), toleranceMm: 240 },
      { kind: 'endpoint', point: point(1100, 1100), toleranceMm: 240 },
    ]
    const result = resolveSnap(target, candidates)
    // The grid point is 14 mm away and the endpoint 127 mm — priority wins.
    expect(result.kind).toBe('endpoint')
    expect(result.point).toEqual({ x: 1100, y: 1100 })
  })

  it('falls to the next priority when the stronger one is out of tolerance', () => {
    const candidates: SnapCandidate[] = [
      { kind: 'grid', point: point(1000, 1000), toleranceMm: 240 },
      { kind: 'endpoint', point: point(5000, 5000), toleranceMm: 240 },
    ]
    expect(resolveSnap(target, candidates).kind).toBe('grid')
  })

  it('breaks a tie between equals by distance', () => {
    const candidates: SnapCandidate[] = [
      { kind: 'endpoint', point: point(1200, 1200), toleranceMm: 500 },
      { kind: 'endpoint', point: point(1020, 1020), toleranceMm: 500 },
    ]
    expect(resolveSnap(target, candidates).point).toEqual({ x: 1020, y: 1020 })
  })

  it('leaves the pointer alone when nothing is close enough', () => {
    const result = resolveSnap(target, [
      { kind: 'grid', point: point(9000, 9000), toleranceMm: 100 },
    ])
    expect(result.kind).toBeNull()
    expect(result.point).toEqual({ x: 1010, y: 1010 })
  })

  it('carries the guide so the canvas can draw it', () => {
    const guide = { from: point(0, 0), to: point(1000, 0) }
    const result = resolveSnap(target, [
      { kind: 'angle', point: point(1000, 1000), toleranceMm: 500, guide },
    ])
    expect(result.guide).toEqual(guide)
  })
})

describe('the ambient pipeline', () => {
  it('offers only the grid with no anchor to measure an angle from', () => {
    const candidates = ambientCandidates(point(1234, 5678), config, 240, null)
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['grid'])
  })

  it('offers an angle candidate once there is something to draw from', () => {
    const candidates = ambientCandidates(point(1234, 100), config, 240, point(0, 0))
    expect(candidates.map((candidate) => candidate.kind)).toEqual(['angle', 'grid'])
  })

  it('makes ortho a constraint, not a suggestion', () => {
    // Way off axis: a tolerance-bound snap would give up, ortho must not.
    const result = snap(point(1000, 4000), { ...config, ortho: true }, 240, point(0, 0))
    expect(result.kind).toBe('angle')
    // Snapped to due south, keeping the distance travelled.
    expect(result.point.x).toBe(0)
    expect(result.point.y).toBe(4123)
  })

  it('lets a scene candidate outrank the ambient ones', () => {
    const result = snap(point(1010, 1010), config, 240, null, [
      { kind: 'endpoint', point: point(1150, 1150), toleranceMm: 240 },
    ])
    expect(result.kind).toBe('endpoint')
  })
})
