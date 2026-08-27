import { describe, expect, it } from 'vitest'
import {
  UNCALIBRATED_MM_PER_PIXEL,
  backgroundBounds,
  calibrateBackground,
  createBackground,
  imageToPlan,
  moveBackground,
  planToImage,
  rotateBackground,
  setBackgroundOpacity,
} from '../src/domain/background'
import { point } from '../src/domain/geometry'

/**
 * Calibration is what turns a photograph into a drawing. The property these
 * tests protect is that it rescales ABOUT THE FIRST POINT the user picked:
 * scaling about the origin is the obvious implementation, and it slides the
 * reference they just identified off across the screen.
 */

const image = createBackground({
  source: 'blob:survey',
  pixelWidth: 2000,
  pixelHeight: 1000,
}).unwrap()

describe('placing an image', () => {
  it('starts uncalibrated but visible and plan-sized', () => {
    expect(image.mmPerPixel).toBe(UNCALIBRATED_MM_PER_PIXEL)
    expect(image.origin).toEqual({ x: 0, y: 0 })
    expect(image.opacity).toBeGreaterThan(0)
    expect(image.opacity).toBeLessThan(1)
  })

  it('refuses an image with no pixels', () => {
    const result = createBackground({ source: 'blob:x', pixelWidth: 0, pixelHeight: 100 })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BACKGROUND_EMPTY')
  })

  it('clamps opacity into something a user can actually see through', () => {
    expect(setBackgroundOpacity(image, 5).opacity).toBe(1)
    expect(setBackgroundOpacity(image, -1).opacity).toBe(0)
  })

  it('covers the plan rectangle its pixels occupy', () => {
    expect(backgroundBounds({ ...image, mmPerPixel: 10 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 20_000,
      maxY: 10_000,
    })
  })
})

describe('the image transform', () => {
  const placed = { ...image, mmPerPixel: 10, origin: point(1000, 2000) }

  it('round-trips a pixel through plan space and back', () => {
    const plan = imageToPlan(placed, { x: 150, y: 40 })

    expect(plan).toEqual({ x: 2500, y: 2400 })
    expect(planToImage(placed, plan)).toEqual({ x: 150, y: 40 })
  })

  it('round-trips through a rotation to within the millimetre a plan stores', () => {
    const turned = rotateBackground(placed, 30)
    const pixel = { x: 640, y: 480 }

    const back = planToImage(turned, imageToPlan(turned, pixel))

    // NOT exact, and it must not be: the plan point in the middle is rounded
    // to a whole millimetre (docs/18 ADR-016), so at 10 mm per pixel the trip
    // back can differ by a twentieth of a pixel. The guarantee worth stating
    // is the one in plan units — a millimetre, never more.
    expect(Math.abs(back.x - pixel.x) * turned.mmPerPixel).toBeLessThanOrEqual(1)
    expect(Math.abs(back.y - pixel.y) * turned.mmPerPixel).toBeLessThanOrEqual(1)
  })
})

describe('calibration', () => {
  it('rescales so the picked distance measures what the user said', () => {
    // Two points 900 image-pixels apart, on a door the user knows is 900 mm…
    const calibrated = calibrateBackground(image, point(100, 0), point(1000, 0), 900).unwrap()

    // …so a pixel is a millimetre, which was already true here — the useful
    // case is the next one.
    expect(calibrated.mmPerPixel).toBeCloseTo(1, 6)
  })

  it('handles the real case: a small image of a large room', () => {
    // 90 pixels across a 900 mm door means every pixel is 10 mm.
    const calibrated = calibrateBackground(image, point(0, 0), point(90, 0), 900).unwrap()

    expect(calibrated.mmPerPixel).toBeCloseTo(10, 6)
    expect(backgroundBounds(calibrated).maxX).toBeCloseTo(20_000, 3)
  })

  it('keeps the FIRST picked point exactly where it was', () => {
    const placed = { ...image, origin: point(500, 500) }
    const from = point(1000, 800)
    const to = point(1090, 800)

    const calibrated = calibrateBackground(placed, from, to, 900).unwrap()

    // The pixel that was under `from` is still under `from` after the rescale.
    const pixelBefore = planToImage(placed, from)
    const pixelAfter = planToImage(calibrated, from)
    expect(pixelAfter.x).toBeCloseTo(pixelBefore.x, 6)
    expect(pixelAfter.y).toBeCloseTo(pixelBefore.y, 6)
  })

  it('makes the second point land at exactly the length that was typed', () => {
    const placed = { ...image, origin: point(500, 500) }
    const from = point(1000, 800)
    const to = point(1090, 800)
    const calibrated = calibrateBackground(placed, from, to, 900).unwrap()

    // The two pixels the user picked are now 900 mm apart in plan space.
    const a = imageToPlan(calibrated, planToImage(placed, from))
    const b = imageToPlan(calibrated, planToImage(placed, to))
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(900, 3)
  })

  it('refuses two identical points and a length of zero', () => {
    const same = calibrateBackground(image, point(10, 10), point(10, 10), 900)
    const nothing = calibrateBackground(image, point(0, 0), point(90, 0), 0)

    expect(same.isErr()).toBe(true)
    if (same.isErr()) expect(same.error.code).toBe('CALIBRATION_NO_LENGTH')
    expect(nothing.isErr()).toBe(true)
    if (nothing.isErr()) expect(nothing.error.code).toBe('CALIBRATION_INVALID_LENGTH')
  })

  it('leaves rotation alone — a crooked photo is crooked at any scale', () => {
    const turned = rotateBackground(image, 12)
    const calibrated = calibrateBackground(turned, point(0, 0), point(90, 0), 900).unwrap()

    expect(calibrated.rotationDeg).toBe(12)
  })
})

describe('moving', () => {
  it('shifts the origin without touching the scale', () => {
    const moved = moveBackground({ ...image, mmPerPixel: 10 }, 250, -125)

    expect(moved.origin).toEqual({ x: 250, y: -125 })
    expect(moved.mmPerPixel).toBe(10)
  })
})
