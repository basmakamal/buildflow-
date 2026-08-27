import { describe, expect, it } from 'vitest'
import {
  finishDelta,
  quoteFinish,
  surfaceQuantity,
  type FinishSpec,
  type RoomSurfaces,
} from '../src/domain/finish-delta'

/**
 * The number a client sees when they pick a nicer tile. docs/08 §8.3
 *
 * Worth testing to the halala: this figure appears next to a 3D render while
 * somebody decides how to spend their money, and a delta that disagrees with
 * the quotation they are sent a week later costs more than the tiles did.
 */

const majlis: RoomSurfaces = {
  roomId: 'room:a',
  name: 'Majlis',
  floorAreaM2: '24.0000',
  wallAreaM2: '60.0000',
  ceilingAreaM2: '24.0000',
  skirtingM: '19.1000',
}

const bedroom: RoomSurfaces = {
  roomId: 'room:b',
  name: 'Bedroom',
  floorAreaM2: '16.0000',
  wallAreaM2: '48.0000',
  ceilingAreaM2: '16.0000',
  skirtingM: '15.2000',
}

const porcelain: FinishSpec = {
  materialId: 'mat-1',
  name: 'Porcelain 60×60',
  rate: '85.0000',
  wasteFactor: '5',
}

const marble: FinishSpec = {
  materialId: 'mat-2',
  name: 'Marble',
  rate: '240.0000',
  wasteFactor: '10',
}

describe('quantities', () => {
  it('applies the waste factor docs/02 §3.7 asks for', () => {
    const quantity = surfaceQuantity(majlis, 'floor', porcelain).unwrap()

    // 24 m² plus 5 % is 25.2.
    expect(quantity.toDecimal()).toBe('25.2000')
    expect(quantity.toJSON().uom).toBe('m2')
  })

  it('multiplies paint by its coats BEFORE waste', () => {
    const paint: FinishSpec = { ...porcelain, coats: '2', wasteFactor: '10' }
    const quantity = surfaceQuantity(majlis, 'wall', paint).unwrap()

    // Waste is a proportion of what is actually applied: 60 × 2 = 120, +10 %.
    expect(quantity.toDecimal()).toBe('132.0000')
  })

  it('measures skirting in metres, not square metres', () => {
    const quantity = surfaceQuantity(majlis, 'skirting', { ...porcelain, wasteFactor: '0' })

    expect(quantity.unwrap().toJSON().uom).toBe('m')
    expect(quantity.unwrap().toDecimal()).toBe('19.1000')
  })

  it('takes ceiling area from the ceiling, not the floor', () => {
    const domed: RoomSurfaces = { ...majlis, ceilingAreaM2: '30.0000' }

    expect(
      surfaceQuantity(domed, 'ceiling', { ...porcelain, wasteFactor: '0' })
        .unwrap()
        .toDecimal(),
    ).toBe('30.0000')
  })
})

describe('quoting a finish', () => {
  it('prices every room and totals them', () => {
    const quote = quoteFinish([majlis, bedroom], 'floor', porcelain, 'SAR').unwrap()

    // 25.2 × 85 = 2142.00, and 16.8 × 85 = 1428.00.
    expect(quote.lines.map((line) => line.amount.toDecimal())).toEqual(['2142.00', '1428.00'])
    expect(quote.total.toDecimal()).toBe('3570.00')
  })

  it('names the room on every line, because a total explains nothing', () => {
    const quote = quoteFinish([majlis, bedroom], 'floor', porcelain, 'SAR').unwrap()

    expect(quote.lines.map((line) => line.roomName)).toEqual(['Majlis', 'Bedroom'])
  })

  it('rejects a currency it cannot count minor units for', () => {
    const result = quoteFinish([majlis], 'floor', porcelain, 'XYZ')

    expect(result.isErr()).toBe(true)
  })
})

describe('the delta', () => {
  it('is the difference over the SAME rooms', () => {
    const result = finishDelta([majlis, bedroom], 'floor', porcelain, marble, 'SAR').unwrap()

    // Marble: (24 + 10 %) × 240 = 6336, (16 + 10 %) × 240 = 4224 → 10 560.
    expect(result.after.total.toDecimal()).toBe('10560.00')
    expect(result.before.total.toDecimal()).toBe('3570.00')
    expect(result.delta.toDecimal()).toBe('6990.00')
  })

  it('reports a saving as a negative, not as an absolute', () => {
    const result = finishDelta([majlis], 'floor', marble, porcelain, 'SAR').unwrap()

    // Downgrading has to read as money BACK, or the panel is lying by omission.
    expect(result.delta.isNegative()).toBe(true)
    expect(result.delta.toDecimal()).toBe('-4194.00')
    expect(result.percent?.startsWith('-')).toBe(true)
  })

  it('states the change as a percentage of what it replaces', () => {
    const result = finishDelta([majlis], 'floor', porcelain, marble, 'SAR').unwrap()

    // 6336 against 2142 is a 195.8 % increase.
    expect(result.percent).toBe('195.80')
  })

  it('offers no percentage against a baseline of zero', () => {
    const free: FinishSpec = { ...porcelain, rate: '0.0000' }
    const result = finishDelta([majlis], 'floor', free, marble, 'SAR').unwrap()

    // "+∞ %" is not information; a client would read it as a fault.
    expect(result.percent).toBeNull()
    expect(result.delta.toDecimal()).toBe('6336.00')
  })

  it('refuses to quote a finish with nothing to apply it to', () => {
    const result = finishDelta([], 'floor', porcelain, marble, 'SAR')

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('FINISH_NO_ROOMS')
  })

  it('is zero when the finish has not really changed', () => {
    const result = finishDelta([majlis], 'wall', porcelain, { ...porcelain }, 'SAR').unwrap()

    expect(result.delta.isZero()).toBe(true)
    expect(result.percent).toBe('0.00')
  })
})
