import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DPI,
  SCALE_RATIOS,
  exportFileName,
  exportLayout,
  titleBlock,
} from '../src/domain/plan-export'
import { toScreen } from '../src/domain/viewport'

/**
 * A plan printed at an arbitrary scale is a picture, not a drawing. A site
 * engineer puts a ruler on the printout and expects 1:100 to mean what it
 * says, so these tests pin the two things that make that true: the scale comes
 * from the standard set, and the viewport really does put the plan on paper at
 * exactly that ratio.
 */

/** A 6 × 4 m room — 6000 × 4000 mm of plan. */
const room = { minX: 0, minY: 0, maxX: 6000, maxY: 4000 }
/** A whole villa floor: 24 × 16 m. */
const villa = { minX: 0, minY: 0, maxX: 24_000, maxY: 16_000 }

describe('choosing the scale', () => {
  it('takes the LARGEST standard scale that fits, not one that merely fills the page', () => {
    // A3 landscape is 420 × 297 mm; less margins, 390 × 267 mm of drawing.
    // A 6 m room needs 6000/ratio ≤ 390, so 1:20 (300 mm) fits and is largest.
    const layout = exportLayout({ bounds: room, paper: 'A3', orientation: 'landscape' })

    expect(layout.scaleRatio).toBe(20)
    expect(layout.scaleLabel).toBe('1:20')
    expect(layout.fits).toBe(true)
  })

  it('steps down for a plan that will not fit at a larger one', () => {
    const layout = exportLayout({ bounds: villa, paper: 'A3', orientation: 'landscape' })

    // 24 m at 1:50 is 480 mm — too wide. 1:100 gives 240 mm, which fits.
    expect(layout.scaleRatio).toBe(100)
  })

  it('honours a scale the user insisted on, and says when it does not fit', () => {
    const layout = exportLayout({ bounds: villa, paper: 'A4', scaleRatio: 20 })

    expect(layout.scaleRatio).toBe(20)
    // Reported rather than silently rescaled to a number nobody can measure.
    expect(layout.fits).toBe(false)
  })

  it('falls back to the smallest standard scale for a site nothing fits', () => {
    const site = { minX: 0, minY: 0, maxX: 400_000, maxY: 300_000 }
    const layout = exportLayout({ bounds: site, paper: 'A4' })

    expect(layout.scaleRatio).toBe(SCALE_RATIOS[SCALE_RATIOS.length - 1])
    expect(layout.fits).toBe(false)
  })

  it('turns the sheet, not the drawing', () => {
    const landscape = exportLayout({ bounds: room, paper: 'A4', orientation: 'landscape' })
    const portrait = exportLayout({ bounds: room, paper: 'A4', orientation: 'portrait' })

    expect(landscape.paperWidthMm).toBe(297)
    expect(portrait.paperWidthMm).toBe(210)
  })
})

describe('the raster', () => {
  it('sizes the image from the sheet and the dpi', () => {
    const layout = exportLayout({ bounds: room, paper: 'A4', orientation: 'landscape' })

    // 297 mm at 150 dpi is 297/25.4×150 ≈ 1754 px.
    expect(layout.widthPx).toBe(Math.round((297 / 25.4) * DEFAULT_DPI))
    expect(layout.heightPx).toBe(Math.round((210 / 25.4) * DEFAULT_DPI))
  })

  it('places the plan at EXACTLY the stated ratio', () => {
    const layout = exportLayout({ bounds: room, paper: 'A3', scaleRatio: 100 })

    // Six metres of wall, at 1:100, is 60 mm of paper — which at 150 dpi is
    // 60/25.4×150 ≈ 354 px. If this drifts, a ruler on the printout disagrees
    // with the number in the title block.
    const left = toScreen(layout.viewport, { x: 0, y: 0 })
    const right = toScreen(layout.viewport, { x: 6000, y: 0 })
    expect(right.x - left.x).toBeCloseTo((60 / 25.4) * DEFAULT_DPI, 6)
  })

  it('centres the drawing on the sheet', () => {
    const layout = exportLayout({ bounds: room, paper: 'A3', scaleRatio: 100 })
    const centre = toScreen(layout.viewport, { x: 3000, y: 2000 })

    expect(centre.x).toBeCloseTo(layout.widthPx / 2, 6)
    expect(centre.y).toBeCloseTo(layout.heightPx / 2, 6)
  })

  it('scales the raster with the dpi, leaving the ratio alone', () => {
    const draft = exportLayout({ bounds: room, paper: 'A3', scaleRatio: 100, dpi: 72 })
    const print = exportLayout({ bounds: room, paper: 'A3', scaleRatio: 100, dpi: 300 })

    expect(print.widthPx).toBeGreaterThan(draft.widthPx * 4)
    expect(print.scaleLabel).toBe(draft.scaleLabel)
  })
})

describe('the title block', () => {
  it('carries the scale that was actually used', () => {
    const layout = exportLayout({ bounds: villa, paper: 'A3' })
    const block = titleBlock({
      planName: 'Ground floor',
      unitLabel: 'Unit 101',
      layout,
      dateLabel: '26 Aug 2026',
      areaLabel: '384.00 m²',
    })

    // Not the scale that was requested — the one the sheet came out at.
    expect(block.scaleLabel).toBe('1:100')
    expect(block.areaLabel).toBe('384.00 m²')
  })
})

describe('the file name', () => {
  it('is something a person can find again six months later', () => {
    expect(exportFileName('Unit 101', 'Ground floor', '2026-08-26')).toBe(
      'unit-101_ground-floor_2026-08-26',
    )
  })

  it('keeps Arabic letters rather than stripping the name to nothing', () => {
    expect(exportFileName('وحدة 101', 'الدور الأرضي', '2026-08-26')).toBe(
      'وحدة-101_الدور-الأرضي_2026-08-26',
    )
  })

  it('never returns an empty name', () => {
    expect(exportFileName('!!!', '???', '')).toBe('floor-plan')
  })
})
