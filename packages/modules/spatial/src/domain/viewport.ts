import { mm, type Bounds, type Point } from './geometry'

/**
 * The viewport — the one place plan millimetres become screen pixels.
 * docs/08 §7.2
 *
 * `scale` is pixels per millimetre, so a 10 m wall at 0.05 draws 500 px wide.
 * Keeping the transform here, pure and tested, is what lets the canvas
 * component stay a renderer: it never computes a coordinate, it only draws
 * what this returns.
 *
 * The invariant every interaction depends on: `toScreen(toWorld(p)) === p`
 * within a pixel. Zooming anchors on a screen point precisely so that the
 * plan does not slide out from under the cursor — the single most-felt
 * difference between a planner that is pleasant and one that is not.
 */

export interface Viewport {
  /** Screen pixels of the world origin — the pan offset. */
  x: number
  y: number
  /** Pixels per millimetre. */
  scale: number
}

export interface ScreenSize {
  width: number
  height: number
}

/**
 * 0.0005 shows a 200 m site; 2 shows a 10 mm detail. Outside that range the
 * canvas is either an empty grid or a single fill, so the clamp is a kindness
 * rather than a restriction.
 */
export const MIN_SCALE = 0.0005
export const MAX_SCALE = 2

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 0.05 }

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export function toScreen(viewport: Viewport, world: Point): Point {
  return {
    x: world.x * viewport.scale + viewport.x,
    y: world.y * viewport.scale + viewport.y,
  }
}

/** Screen → plan, rounded to the whole millimetre the plan stores. */
export function toWorld(viewport: Viewport, screen: Point): Point {
  return {
    x: mm((screen.x - viewport.x) / viewport.scale),
    y: mm((screen.y - viewport.y) / viewport.scale),
  }
}

export function pan(viewport: Viewport, deltaX: number, deltaY: number): Viewport {
  return { ...viewport, x: viewport.x + deltaX, y: viewport.y + deltaY }
}

/**
 * Zooms by `factor` about a SCREEN anchor — usually the cursor.
 *
 * The world point under the anchor stays under it, which is what makes
 * wheel-zoom feel like moving a physical drawing rather than a slideshow.
 * Clamping happens before the offset is solved, so a zoom that hits the limit
 * still leaves the anchor fixed instead of drifting.
 */
export function zoomAt(viewport: Viewport, anchor: Point, factor: number): Viewport {
  const scale = clampScale(viewport.scale * factor)
  if (scale === viewport.scale) return viewport

  // Solve offset' so that anchor maps to the same world point as before.
  const worldX = (anchor.x - viewport.x) / viewport.scale
  const worldY = (anchor.y - viewport.y) / viewport.scale
  return {
    scale,
    x: anchor.x - worldX * scale,
    y: anchor.y - worldY * scale,
  }
}

/**
 * Frames `bounds` in the given screen size with a pixel margin.
 *
 * Degenerate bounds — a single point, or a perfectly straight wall with no
 * height — would divide by zero, so they fall back to the current scale and
 * simply centre. That case is real: it is what "zoom to fit" does on a plan
 * holding one wall.
 */
export function fitToBounds(
  viewport: Viewport,
  bounds: Bounds,
  size: ScreenSize,
  paddingPx = 48,
): Viewport {
  const widthMm = bounds.maxX - bounds.minX
  const heightMm = bounds.maxY - bounds.minY
  const usableWidth = Math.max(1, size.width - paddingPx * 2)
  const usableHeight = Math.max(1, size.height - paddingPx * 2)

  const scale =
    widthMm > 0 && heightMm > 0
      ? clampScale(Math.min(usableWidth / widthMm, usableHeight / heightMm))
      : viewport.scale

  const centreX = (bounds.minX + bounds.maxX) / 2
  const centreY = (bounds.minY + bounds.maxY) / 2
  return {
    scale,
    x: size.width / 2 - centreX * scale,
    y: size.height / 2 - centreY * scale,
  }
}

/** The plan rectangle currently on screen — what a renderer needs to cull to. */
export function visibleBounds(viewport: Viewport, size: ScreenSize): Bounds {
  const topLeft = toWorld(viewport, { x: 0, y: 0 })
  const bottomRight = toWorld(viewport, { x: size.width, y: size.height })
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y),
  }
}

/** Screen pixels → plan millimetres, for tolerances quoted in pixels. */
export const pxToMm = (viewport: Viewport, px: number): number => px / viewport.scale

/**
 * The grid spacing to DRAW at this zoom.
 *
 * A fixed 100 mm grid is a grey wash at site zoom and four lines at detail
 * zoom. Stepping through 1-2-5 decades keeps lines between roughly 8 and 80
 * pixels apart at every scale, which is the range where a grid helps instead
 * of shouting. The SNAP grid is a separate, user-chosen number — what is drawn
 * and what is snapped to are different questions.
 */
export function gridStepMm(viewport: Viewport, minSpacingPx = 12): number {
  const steps = [10, 20, 50]
  for (let decade = 0; decade <= 6; decade += 1) {
    for (const step of steps) {
      const candidate = step * 10 ** decade
      if (candidate * viewport.scale >= minSpacingPx) return candidate
    }
  }
  return 10 ** 7
}
