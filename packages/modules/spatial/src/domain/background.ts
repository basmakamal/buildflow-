import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import { boundsOf, distance, mm, point, type Bounds, type Point } from './geometry'

/**
 * The background underlay, and the calibration that makes it useful.
 * docs/08 §7.1
 *
 * Almost every real plan starts as a photograph or a PDF export of somebody
 * else's drawing. Tracing it is only worth anything if the trace comes out at
 * the right SIZE, and an image carries no scale — so the user names one
 * distance they know ("this door is 900 mm") and everything else follows.
 *
 * `mmPerPixel` is that answer, and it is the only number calibration changes.
 * The image is otherwise an ordinary object in plan space: an origin, a
 * rotation, an opacity, and a lock so that tracing over it cannot drag it.
 */

export interface Background {
  /** A handle the renderer can load — object URL or data URL. Never fetched here. */
  source: string
  /** Plan position of the image's top-left pixel. */
  origin: Point
  /** Plan millimetres per image pixel. What calibration solves for. */
  mmPerPixel: number
  rotationDeg: number
  /** 0–1. Low enough to draw over, high enough to read. */
  opacity: number
  locked: boolean
  /** Natural size, in image pixels. */
  pixelWidth: number
  pixelHeight: number
}

/**
 * An uncalibrated image is placed at one millimetre per pixel — wrong, but
 * visible and roughly plan-sized, which is what a user needs before they can
 * pick the two points that make it right.
 */
export const UNCALIBRATED_MM_PER_PIXEL = 1
export const DEFAULT_BACKGROUND_OPACITY = 0.45

export interface BackgroundInput {
  source: string
  pixelWidth: number
  pixelHeight: number
  origin?: Point
  mmPerPixel?: number
  rotationDeg?: number
  opacity?: number
  locked?: boolean
}

export function createBackground(input: BackgroundInput): Result<Background, DomainError> {
  if (input.pixelWidth <= 0 || input.pixelHeight <= 0) {
    return err(validationError('BACKGROUND_EMPTY', 'The image has no pixels to place'))
  }

  const mmPerPixel = input.mmPerPixel ?? UNCALIBRATED_MM_PER_PIXEL
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) {
    return err(validationError('BACKGROUND_INVALID_SCALE', 'The image scale must be positive'))
  }

  const opacity = input.opacity ?? DEFAULT_BACKGROUND_OPACITY
  return ok({
    source: input.source,
    origin: point(input.origin?.x ?? 0, input.origin?.y ?? 0),
    mmPerPixel,
    rotationDeg: (((input.rotationDeg ?? 0) % 360) + 360) % 360,
    opacity: Math.min(1, Math.max(0, opacity)),
    locked: input.locked ?? false,
    pixelWidth: Math.round(input.pixelWidth),
    pixelHeight: Math.round(input.pixelHeight),
  })
}

/** Image pixel → plan millimetres, through scale then rotation then origin. */
export function imageToPlan(background: Background, pixel: Point): Point {
  const radians = (background.rotationDeg * Math.PI) / 180
  const x = pixel.x * background.mmPerPixel
  const y = pixel.y * background.mmPerPixel
  return point(
    background.origin.x + x * Math.cos(radians) - y * Math.sin(radians),
    background.origin.y + x * Math.sin(radians) + y * Math.cos(radians),
  )
}

/** Plan millimetres → image pixel. The exact inverse of `imageToPlan`. */
export function planToImage(background: Background, plan: Point): Point {
  const radians = (-background.rotationDeg * Math.PI) / 180
  const dx = plan.x - background.origin.x
  const dy = plan.y - background.origin.y
  const x = dx * Math.cos(radians) - dy * Math.sin(radians)
  const y = dx * Math.sin(radians) + dy * Math.cos(radians)
  return { x: x / background.mmPerPixel, y: y / background.mmPerPixel }
}

/** The plan rectangle the image covers, rotation included. */
export function backgroundBounds(background: Background): Bounds {
  const corners = [
    imageToPlan(background, { x: 0, y: 0 }),
    imageToPlan(background, { x: background.pixelWidth, y: 0 }),
    imageToPlan(background, { x: background.pixelWidth, y: background.pixelHeight }),
    imageToPlan(background, { x: 0, y: background.pixelHeight }),
  ]
  return (
    boundsOf(corners) ?? {
      minX: background.origin.x,
      minY: background.origin.y,
      maxX: background.origin.x,
      maxY: background.origin.y,
    }
  )
}

/**
 * Calibrates the image so that the two plan points the user picked are
 * `knownLengthMm` apart.
 *
 * The image is rescaled ABOUT `from`, so the first point the user clicked
 * stays exactly where they clicked it. Scaling about the origin instead is the
 * obvious implementation and the wrong one: the reference the user just
 * identified would slide across the screen as the scale changed, and they
 * would have to hunt for it again to check the result.
 *
 * Only `mmPerPixel` and `origin` move. Rotation is a separate gesture,
 * because a survey photo that is crooked is crooked whatever its scale.
 */
export function calibrateBackground(
  background: Background,
  from: Point,
  to: Point,
  knownLengthMm: number,
): Result<Background, DomainError> {
  const measured = distance(from, to)
  if (measured <= 0) {
    return err(
      validationError('CALIBRATION_NO_LENGTH', 'Pick two different points to calibrate against'),
    )
  }
  if (!Number.isFinite(knownLengthMm) || knownLengthMm <= 0) {
    return err(
      validationError('CALIBRATION_INVALID_LENGTH', 'The known length must be greater than zero'),
    )
  }

  const factor = mm(knownLengthMm) / measured
  const mmPerPixel = background.mmPerPixel * factor
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) {
    return err(validationError('BACKGROUND_INVALID_SCALE', 'The image scale must be positive'))
  }

  return ok({
    ...background,
    mmPerPixel,
    origin: point(
      from.x + (background.origin.x - from.x) * factor,
      from.y + (background.origin.y - from.y) * factor,
    ),
  })
}

/**
 * What one image pixel measures, once calibrated — the number a user checks a
 * calibration against, and the one worth showing them.
 */
export const backgroundScaleLabel = (background: Background): number => background.mmPerPixel

export const moveBackground = (
  background: Background,
  deltaXMm: number,
  deltaYMm: number,
): Background => ({
  ...background,
  origin: point(background.origin.x + deltaXMm, background.origin.y + deltaYMm),
})

export const setBackgroundOpacity = (background: Background, opacity: number): Background => ({
  ...background,
  opacity: Math.min(1, Math.max(0, opacity)),
})

export const setBackgroundLocked = (background: Background, locked: boolean): Background => ({
  ...background,
  locked,
})

export const rotateBackground = (background: Background, degrees: number): Background => ({
  ...background,
  rotationDeg: ((degrees % 360) + 360) % 360,
})
