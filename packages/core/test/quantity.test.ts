import { describe, it, expect } from 'vitest'
import { Quantity } from '../src/quantity'

describe('Quantity', () => {
  it('parses and formats at 4 decimal places', () => {
    expect(Quantity.from('26.95', 'm2').unwrap().toDecimal()).toBe('26.9500')
  })

  it('rejects excess precision', () => {
    expect(Quantity.from('1.234567', 'm2').isErr()).toBe(true)
  })

  it('refuses to combine different units of measure', () => {
    // The bug this class exists to prevent: boxes minus square metres.
    const boxes = Quantity.from('40', 'box').unwrap()
    const area = Quantity.from('52', 'm2').unwrap()
    expect(() => boxes.add(area)).toThrow(/Cannot combine box with m2/)
  })

  describe('waste factor', () => {
    it('applies the 10% tile default', () => {
      // 24.50 m² of floor + 10% waste = 26.95 — the worked BOQ line in docs/15.
      const floor = Quantity.from('24.50', 'm2').unwrap()
      expect(floor.withWaste('10').unwrap().toDecimal()).toBe('26.9500')
    })

    it('applies a fractional factor', () => {
      const marble = Quantity.from('18.00', 'm2').unwrap()
      expect(marble.withWaste('17.5').unwrap().toDecimal()).toBe('21.1500')
    })

    it('is a no-op at zero', () => {
      const q = Quantity.from('10.00', 'm2').unwrap()
      expect(q.withWaste('0').unwrap().equals(q)).toBe(true)
    })

    it('rejects a negative waste factor', () => {
      expect(Quantity.from('10', 'm2').unwrap().withWaste('-5').isErr()).toBe(true)
    })
  })

  describe('unit conversion', () => {
    it('converts boxes to m² with a material-specific factor', () => {
      // 40 boxes of 60×60 tiles at 1.44 m² per box.
      const boxes = Quantity.from('40', 'box').unwrap()
      const area = boxes.convertTo('m2', '1.44').unwrap()
      expect(area.toDecimal()).toBe('57.6000')
      expect(area.uom).toBe('m2')
    })

    it('uses a different factor for a different tile size', () => {
      // 30×30 tiles cover 0.99 m² per box — proving there is no global factor.
      const boxes = Quantity.from('40', 'box').unwrap()
      expect(boxes.convertTo('m2', '0.99').unwrap().toDecimal()).toBe('39.6000')
    })
  })

  describe('ledger arithmetic', () => {
    it('reproduces the worked tile example from docs/14', () => {
      // purchased 57.6, consumed 31.2 + 18.4, wasted 2.9 → remaining 5.1
      const purchased = Quantity.from('57.6', 'm2').unwrap()
      const used = Quantity.from('31.2', 'm2')
        .unwrap()
        .add(Quantity.from('18.4', 'm2').unwrap())
        .add(Quantity.from('2.9', 'm2').unwrap())
      expect(used.toDecimal()).toBe('52.5000')
      expect(purchased.subtract(used).toDecimal()).toBe('5.1000')
    })

    it('detects a negative balance', () => {
      const remaining = Quantity.from('5.0', 'm2')
        .unwrap()
        .subtract(Quantity.from('7.5', 'm2').unwrap())
      expect(remaining.isNegative()).toBe(true)
    })
  })

  it('emits the API contract shape', () => {
    expect(Quantity.from('48.5', 'm2').unwrap().toJSON()).toEqual({
      value: '48.5000',
      uom: 'm2',
    })
  })
})
