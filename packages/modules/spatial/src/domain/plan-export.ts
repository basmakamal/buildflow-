import type { Bounds } from './geometry'
import type { Viewport } from './viewport'

/**
 * The export layout — a drawing's geometry ON PAPER, not its pixels.
 * docs/16 Phase 5 sprint 7
 *
 * The same shape as `quotation-document.ts` in the estimation module, and for
 * the same reason: this computes what the sheet contains and at what scale,
 * while the renderer only turns that into an image. A layout is then testable
 * without rendering anything, and "the A3 came out at 1:87" is a unit-test
 * failure rather than something somebody notices after printing.
 *
 * A plan printed at an ARBITRARY scale is not a drawing — it is a picture. A
 * site engineer puts a ruler on a printout and expects 1:50 or 1:100 to mean
 * what it says, so the scale is chosen from the standard set and stated on the
 * sheet, never fitted to whatever happens to fill the page.
 */

export type PaperSize = 'A4' | 'A3'
export type Orientation = 'landscape' | 'portrait'

/** Trimmed sheet sizes in millimetres, portrait. */
const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
}

/**
 * The architectural scales, largest drawing first.
 *
 * 1:20 is a detail, 1:200 a site layout. Anything outside this range is either
 * unreadable or does not fit through a printer.
 */
export const SCALE_RATIOS = [20, 25, 50, 100, 200, 500] as const
export type ScaleRatio = (typeof SCALE_RATIOS)[number]

/** The last resort for a plan nothing fits — a site layout, clipped. */
const SMALLEST_SCALE: ScaleRatio = 500

/** Room for a title block and a printer's unprintable edge. */
export const DEFAULT_MARGIN_MM = 15
export const DEFAULT_DPI = 150

export interface ExportRequest {
  /** What has to fit: the plan's own bounds, in plan millimetres. */
  bounds: Bounds
  paper?: PaperSize
  orientation?: Orientation
  /** Force a scale. Omit to take the largest standard one that fits. */
  scaleRatio?: ScaleRatio
  marginMm?: number
  dpi?: number
}

export interface ExportLayout {
  paper: PaperSize
  orientation: Orientation
  /** Sheet size in millimetres, after orientation. */
  paperWidthMm: number
  paperHeightMm: number
  marginMm: number
  /** 100 means 1:100 — one millimetre on paper is a hundred on site. */
  scaleRatio: ScaleRatio
  /** What is printed on the sheet, and what a ruler is checked against. */
  scaleLabel: string
  /** Raster size at the requested dpi. */
  widthPx: number
  heightPx: number
  /**
   * The viewport that puts the plan on the sheet at exactly `scaleRatio`,
   * centred. The renderer sets this and draws — it computes nothing.
   */
  viewport: Viewport
  /**
   * False when even the smallest standard scale cannot fit the plan on the
   * chosen sheet. The drawing is still produced — clipped rather than silently
   * rescaled to a number nobody can measure against.
   */
  fits: boolean
}

const mmToPx = (valueMm: number, dpi: number): number => Math.round((valueMm / 25.4) * dpi)

/**
 * Whether a plan fits a sheet at a given scale, margins included.
 *
 * Both orientations of the PLAN are not considered: rotating a drawing to make
 * it fit changes which way north points, and that is the user's decision, not
 * this function's.
 */
function fitsAt(bounds: Bounds, ratio: number, usableWidthMm: number, usableHeightMm: number) {
  const widthOnPaper = (bounds.maxX - bounds.minX) / ratio
  const heightOnPaper = (bounds.maxY - bounds.minY) / ratio
  return widthOnPaper <= usableWidthMm && heightOnPaper <= usableHeightMm
}

export function exportLayout(request: ExportRequest): ExportLayout {
  const paper = request.paper ?? 'A3'
  const orientation = request.orientation ?? 'landscape'
  const marginMm = request.marginMm ?? DEFAULT_MARGIN_MM
  const dpi = request.dpi ?? DEFAULT_DPI

  const sheet = PAPER_MM[paper]
  const paperWidthMm = orientation === 'landscape' ? sheet.height : sheet.width
  const paperHeightMm = orientation === 'landscape' ? sheet.width : sheet.height

  const usableWidthMm = paperWidthMm - marginMm * 2
  const usableHeightMm = paperHeightMm - marginMm * 2

  const chosen =
    request.scaleRatio ??
    SCALE_RATIOS.find((ratio) => fitsAt(request.bounds, ratio, usableWidthMm, usableHeightMm)) ??
    SMALLEST_SCALE

  const widthPx = mmToPx(paperWidthMm, dpi)
  const heightPx = mmToPx(paperHeightMm, dpi)

  // Pixels per PLAN millimetre: the sheet's dots per millimetre, divided by how
  // many plan millimetres each paper millimetre represents.
  const scale = dpi / 25.4 / chosen
  const centreX = (request.bounds.minX + request.bounds.maxX) / 2
  const centreY = (request.bounds.minY + request.bounds.maxY) / 2

  return {
    paper,
    orientation,
    paperWidthMm,
    paperHeightMm,
    marginMm,
    scaleRatio: chosen,
    scaleLabel: `1:${chosen}`,
    widthPx,
    heightPx,
    viewport: {
      scale,
      x: widthPx / 2 - centreX * scale,
      y: heightPx / 2 - centreY * scale,
    },
    fits: fitsAt(request.bounds, chosen, usableWidthMm, usableHeightMm),
  }
}

/**
 * The title block's CONTENT. Strings only — already formatted, already in the
 * caller's language, so a renderer decides nothing and an Arabic sheet cannot
 * come out with English digits in the corner.
 */
export interface TitleBlock {
  planName: string
  unitLabel: string
  scaleLabel: string
  dateLabel: string
  areaLabel: string
}

export interface TitleBlockInput {
  planName: string
  unitLabel: string
  layout: ExportLayout
  /** Pre-formatted by the caller — this module owns no clock and no locale. */
  dateLabel: string
  areaLabel: string
}

export const titleBlock = (input: TitleBlockInput): TitleBlock => ({
  planName: input.planName,
  unitLabel: input.unitLabel,
  scaleLabel: input.layout.scaleLabel,
  dateLabel: input.dateLabel,
  areaLabel: input.areaLabel,
})

/**
 * A file name a person can find again six months later: the unit, the plan,
 * and the date — no spaces, no characters a file system objects to.
 */
export function exportFileName(unitLabel: string, planName: string, dateLabel: string): string {
  const slug = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')

  return (
    [slug(unitLabel), slug(planName), slug(dateLabel)].filter(Boolean).join('_') || 'floor-plan'
  )
}
