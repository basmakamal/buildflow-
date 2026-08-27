import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  fitToBounds,
  gridStepMm,
  pan,
  pxToMm,
  toScreen,
  toWorld,
  visibleBounds,
  zoomAt,
} from '../src/domain/viewport'
import { point } from '../src/domain/geometry'

/**
 * The transform every interaction rests on. The property that matters most is
 * the zoom anchor: the plan must not slide out from under the cursor, which is
 * the difference between a planner that feels physical and one that does not.
 */

const view = { x: 100, y: 50, scale: 0.05 }

describe('the transform', () => {
  it('round-trips a point through screen and back', () => {
    const world = point(4000, 2500)
    expect(toWorld(view, toScreen(view, world))).toEqual(world)
  })

  it('places the world origin at the pan offset', () => {
    expect(toScreen(view, point(0, 0))).toEqual({ x: 100, y: 50 })
  })

  it('rounds incoming screen points to whole millimetres', () => {
    // 0.05 px/mm means one pixel is 20 mm — a fractional pixel must not
    // produce a fractional millimetre. docs/18 ADR-016
    const world = toWorld(view, { x: 100.4, y: 50.4 })
    expect(Number.isInteger(world.x)).toBe(true)
    expect(Number.isInteger(world.y)).toBe(true)
  })

  it('pans without touching the scale', () => {
    const panned = pan(view, 25, -10)
    expect(panned).toEqual({ x: 125, y: 40, scale: 0.05 })
  })
})

describe('zooming', () => {
  it('keeps the world point under the anchor exactly where it was', () => {
    const anchor = { x: 640, y: 360 }
    const before = toWorld(view, anchor)
    const zoomed = zoomAt(view, anchor, 1.25)

    expect(zoomed.scale).toBeCloseTo(0.0625, 10)
    // The whole point: same anchor, same world coordinate.
    expect(toWorld(zoomed, anchor)).toEqual(before)
  })

  it('holds the anchor through a zoom in and back out', () => {
    const anchor = { x: 300, y: 200 }
    const before = toWorld(view, anchor)
    const round = zoomAt(zoomAt(view, anchor, 2), anchor, 0.5)
    expect(toWorld(round, anchor)).toEqual(before)
  })

  it('clamps at both ends and stops rather than drifting', () => {
    const zoomedOut = zoomAt({ x: 0, y: 0, scale: MIN_SCALE }, { x: 10, y: 10 }, 0.5)
    expect(zoomedOut.scale).toBe(MIN_SCALE)
    // Returned unchanged, so the anchor cannot slide at the limit.
    expect(zoomedOut).toEqual({ x: 0, y: 0, scale: MIN_SCALE })

    const zoomedIn = zoomAt({ x: 0, y: 0, scale: MAX_SCALE }, { x: 10, y: 10 }, 2)
    expect(zoomedIn.scale).toBe(MAX_SCALE)
  })
})

describe('fit to bounds', () => {
  const size = { width: 1000, height: 600 }

  it('frames the bounds and centres them', () => {
    // A 10 m × 5 m plan in a 1000 × 600 viewport with 48 px padding.
    const bounds = { minX: 0, minY: 0, maxX: 10_000, maxY: 5000 }
    const fitted = fitToBounds(DEFAULT_VIEWPORT, bounds, size)

    // Width binds: 904 usable px / 10,000 mm.
    expect(fitted.scale).toBeCloseTo(0.0904, 6)
    const centre = toScreen(fitted, point(5000, 2500))
    expect(centre.x).toBeCloseTo(500, 6)
    expect(centre.y).toBeCloseTo(300, 6)
  })

  it('centres a degenerate plan instead of dividing by zero', () => {
    // One wall, perfectly horizontal: no height to fit.
    const fitted = fitToBounds(view, { minX: 0, minY: 0, maxX: 5000, maxY: 0 }, size)
    expect(fitted.scale).toBe(view.scale)
    expect(toScreen(fitted, point(2500, 0))).toEqual({ x: 500, y: 300 })
  })
})

describe('helpers the renderer needs', () => {
  it('reports the plan rectangle on screen', () => {
    const bounds = visibleBounds({ x: 0, y: 0, scale: 0.1 }, { width: 800, height: 600 })
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 8000, maxY: 6000 })
  })

  it('converts a pixel tolerance into plan millimetres', () => {
    // 12 px of slop at 0.05 px/mm is 240 mm of plan.
    expect(pxToMm(view, 12)).toBe(240)
  })

  it('steps the drawn grid through 1-2-5 decades so lines stay legible', () => {
    // Zoomed out on a site: metres, not centimetres.
    expect(gridStepMm({ x: 0, y: 0, scale: 0.005 })).toBe(5000)
    expect(gridStepMm({ x: 0, y: 0, scale: 0.05 })).toBe(500)
    expect(gridStepMm({ x: 0, y: 0, scale: 0.5 })).toBe(50)
    // Whatever the zoom, the chosen step is at least the minimum spacing.
    for (const scale of [0.001, 0.01, 0.08, 0.3, 1.5]) {
      expect(gridStepMm({ x: 0, y: 0, scale }) * scale).toBeGreaterThanOrEqual(12)
    }
  })
})
