import { describe, expect, it } from 'vitest'
import {
  MIN_SECTION_MM,
  alignColumnTo,
  beamLengthMm,
  createBeam,
  createColumn,
  hitTestStructural,
  structuralBounds,
  structuralCentre,
  structuralHit,
  structuralPolygon,
  translateStructural,
} from '../src/domain/structural'
import { point } from '../src/domain/geometry'

/**
 * Two footprints cover all four structural kinds, and everything downstream
 * reads only the derived polygon. The test that matters most is the rotated
 * column: its bounding box is 41 % larger than the column itself, and hit
 * testing against the box would select something the user cannot see there.
 */

const column = (x: number, y: number, rotationDeg = 0) =>
  createColumn({
    id: 'c1',
    centre: point(x, y),
    widthMm: 400,
    depthMm: 200,
    rotationDeg,
  }).unwrap()

describe('columns', () => {
  it('takes a square section when only a width is given', () => {
    const square = createColumn({ id: 'c', centre: point(0, 0), widthMm: 300 }).unwrap()

    expect(square.depthMm).toBe(300)
    expect(square.kind).toBe('column')
  })

  it('refuses a section too small to be a member', () => {
    const result = createColumn({
      id: 'c',
      centre: point(0, 0),
      widthMm: MIN_SECTION_MM - 1,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('SECTION_TOO_SMALL')
  })

  it('normalises rotation, so two identical columns compare equal', () => {
    expect(
      createColumn({ id: 'c', centre: point(0, 0), rotationDeg: -90 }).unwrap().rotationDeg,
    ).toBe(270)
    expect(
      createColumn({ id: 'c', centre: point(0, 0), rotationDeg: 450 }).unwrap().rotationDeg,
    ).toBe(90)
  })

  it('corners the rectangle about its centre', () => {
    expect(structuralPolygon(column(1000, 1000))).toEqual([
      { x: 800, y: 900 },
      { x: 1200, y: 900 },
      { x: 1200, y: 1100 },
      { x: 800, y: 1100 },
    ])
  })

  it('turns the footprint, not just the bounds', () => {
    const turned = column(0, 0, 90)

    expect(structuralPolygon(turned)).toEqual([
      { x: 100, y: -200 },
      { x: 100, y: 200 },
      { x: -100, y: 200 },
      { x: -100, y: -200 },
    ])
    expect(structuralBounds(turned)).toEqual({ minX: -100, minY: -200, maxX: 100, maxY: 200 })
  })

  it('hit tests in the column OWN frame, not against its bounding box', () => {
    const diagonal = column(0, 0, 45)
    const bounds = structuralBounds(diagonal)

    // The box corner is empty space; the column is not there.
    expect(structuralHit(diagonal, point(bounds.maxX - 5, bounds.maxY - 5), 0)).toBe(false)
    expect(structuralHit(diagonal, point(0, 0), 0)).toBe(true)
  })

  it('aligns with a wall running through it', () => {
    const aligned = alignColumnTo(column(0, 0), { start: point(0, 0), end: point(1000, 1000) })

    expect(aligned.rotationDeg).toBe(45)
  })
})

describe('beams', () => {
  const beam = createBeam({
    id: 'b1',
    start: point(0, 0),
    end: point(6000, 0),
    widthMm: 250,
  }).unwrap()

  it('refuses one too short to be a span', () => {
    const result = createBeam({ id: 'b', start: point(0, 0), end: point(50, 0) })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BEAM_TOO_SHORT')
  })

  it('spans its two points with a width either side', () => {
    expect(structuralPolygon(beam)).toEqual([
      { x: 0, y: 125 },
      { x: 6000, y: 125 },
      { x: 6000, y: -125 },
      { x: 0, y: -125 },
    ])
    expect(beamLengthMm(beam)).toBe(6000)
    expect(structuralCentre(beam)).toEqual({ x: 3000, y: 0 })
  })

  it('is hit along its span, forgiven by half its width', () => {
    expect(structuralHit(beam, point(3000, 120), 0)).toBe(true)
    expect(structuralHit(beam, point(3000, 200), 0)).toBe(false)
    expect(structuralHit(beam, point(3000, 200), 100)).toBe(true)
  })
})

describe('the shared surface', () => {
  it('translates either footprint by the same call', () => {
    const movedColumn = translateStructural(column(1000, 1000), 100, 50)
    const movedBeam = translateStructural(
      createBeam({ id: 'b', start: point(0, 0), end: point(1000, 0) }).unwrap(),
      100,
      50,
    )

    expect(movedColumn.centre).toEqual({ x: 1100, y: 1050 })
    expect(movedBeam.start).toEqual({ x: 100, y: 50 })
    expect(movedBeam.end).toEqual({ x: 1100, y: 50 })
  })

  it('returns the topmost element where two overlap', () => {
    const lower = { ...column(0, 0), id: 'lower' }
    const upper = { ...column(0, 0), id: 'upper' }

    expect(hitTestStructural([lower, upper], point(0, 0), 0)).toBe('upper')
    expect(hitTestStructural([lower, upper], point(9000, 9000), 0)).toBeNull()
  })
})
