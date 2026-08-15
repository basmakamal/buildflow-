import { describe, it, expect } from 'vitest'
import { Money } from '../src/money'

describe('Money', () => {
  describe('float-error avoidance', () => {
    it('adds amounts that would drift as floats', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
      const a = Money.fromDecimal('0.10', 'SAR').unwrap()
      const b = Money.fromDecimal('0.20', 'SAR').unwrap()
      expect(a.add(b).toDecimal()).toBe('0.30')
    })

    it('stays exact across a BOQ-sized accumulation', () => {
      // 147 lines at 0.07 — the shape of a real bill of quantities.
      let total = Money.zero('SAR')
      const line = Money.fromDecimal('0.07', 'SAR').unwrap()
      for (let i = 0; i < 147; i++) total = total.add(line)
      expect(total.toDecimal()).toBe('10.29')
    })
  })

  describe('three-decimal Gulf currencies', () => {
    // A two-decimal assumption is wrong by a factor of ten in these markets.
    it('stores KWD at three decimal places', () => {
      const m = Money.fromDecimal('1.234', 'KWD').unwrap()
      expect(m.minor).toBe(1234n)
      expect(m.toDecimal()).toBe('1.234')
    })

    it.each(['KWD', 'BHD', 'OMR'] as const)('rejects excess precision for %s', (currency) => {
      const result = Money.fromDecimal('1.2345', currency)
      expect(result.isErr()).toBe(true)
    })

    it('rejects three decimals for a two-decimal currency', () => {
      expect(Money.fromDecimal('1.234', 'SAR').isErr()).toBe(true)
    })
  })

  describe('parsing', () => {
    it('pads a missing fraction', () => {
      expect(Money.fromDecimal('1250', 'SAR').unwrap().minor).toBe(125_000n)
    })

    it('handles negatives', () => {
      const m = Money.fromDecimal('-45.50', 'SAR').unwrap()
      expect(m.minor).toBe(-4550n)
      expect(m.toDecimal()).toBe('-45.50')
      expect(m.isNegative()).toBe(true)
    })

    it.each(['abc', '', '1.2.3', '1,250.00', '1e5'])('rejects %j', (input) => {
      expect(Money.fromDecimal(input, 'SAR').isErr()).toBe(true)
    })
  })

  describe('currency safety', () => {
    it('refuses to add different currencies', () => {
      const sar = Money.fromDecimal('100.00', 'SAR').unwrap()
      const aed = Money.fromDecimal('100.00', 'AED').unwrap()
      expect(() => sar.add(aed)).toThrow(/Cannot combine SAR with AED/)
    })
  })

  describe('percentage', () => {
    it('computes 15% VAT (KSA)', () => {
      const net = Money.fromDecimal('285000.00', 'SAR').unwrap()
      expect(net.percentage('15').unwrap().toDecimal()).toBe('42750.00')
    })

    it('computes 5% VAT (UAE)', () => {
      const net = Money.fromDecimal('1000.00', 'AED').unwrap()
      expect(net.percentage('5').unwrap().toDecimal()).toBe('50.00')
    })

    it('rounds half away from zero, not to even', () => {
      // 0.125 → 0.13. Banker's rounding would give 0.12 and disagree with a
      // hand-checked invoice.
      const m = Money.fromDecimal('2.50', 'SAR').unwrap()
      expect(m.percentage('5').unwrap().toDecimal()).toBe('0.13')
    })
  })

  describe('multiply', () => {
    it('multiplies by a fractional quantity', () => {
      const rate = Money.fromDecimal('85.00', 'SAR').unwrap()
      // 26.95 m² of porcelain at 85.00 — a real BOQ line.
      expect(rate.multiply('26.95').unwrap().toDecimal()).toBe('2290.75')
    })

    it('rounds the half case away from zero', () => {
      const rate = Money.fromDecimal('0.05', 'SAR').unwrap()
      expect(rate.multiply('1.5').unwrap().toDecimal()).toBe('0.08')
    })
  })

  describe('allocate', () => {
    // Allocating a supplier invoice across units must not lose or invent a halala.
    it('splits without losing a minor unit', () => {
      const invoice = Money.fromDecimal('100.00', 'SAR').unwrap()
      const parts = invoice.allocate(3)
      expect(parts.map((p) => p.toDecimal())).toEqual(['33.34', '33.33', '33.33'])
      const sum = parts.reduce((a, b) => a.add(b), Money.zero('SAR'))
      expect(sum.equals(invoice)).toBe(true)
    })

    it('splits exactly when divisible', () => {
      const parts = Money.fromDecimal('90.00', 'SAR').unwrap().allocate(3)
      expect(parts.map((p) => p.toDecimal())).toEqual(['30.00', '30.00', '30.00'])
    })

    it('preserves the total for negative amounts', () => {
      const credit = Money.fromDecimal('-100.00', 'SAR').unwrap()
      const parts = credit.allocate(3)
      const sum = parts.reduce((a, b) => a.add(b), Money.zero('SAR'))
      expect(sum.equals(credit)).toBe(true)
    })

    it('is deterministic', () => {
      const invoice = Money.fromDecimal('100.00', 'SAR').unwrap()
      expect(invoice.allocate(7).map((p) => p.toDecimal())).toEqual(
        invoice.allocate(7).map((p) => p.toDecimal()),
      )
    })

    it('rejects a non-positive part count', () => {
      expect(() => Money.fromDecimal('10.00', 'SAR').unwrap().allocate(0)).toThrow(RangeError)
    })
  })

  describe('allocateByWeights', () => {
    it('allocates a truck-load invoice across units by area, summing exactly', () => {
      const invoice = Money.fromDecimal('12400.00', 'SAR').unwrap()
      const areas = [1425n, 1980n, 1120n] // m² × 10
      const parts = invoice.allocateByWeights(areas)
      const sum = parts.reduce((a, b) => a.add(b), Money.zero('SAR'))
      expect(sum.equals(invoice)).toBe(true)
      expect(parts[1]!.greaterThan(parts[0]!)).toBe(true) // largest area, largest share
    })

    it('rejects weights summing to zero', () => {
      const m = Money.fromDecimal('10.00', 'SAR').unwrap()
      expect(() => m.allocateByWeights([0n, 0n])).toThrow(RangeError)
    })
  })

  describe('serialisation', () => {
    it('emits the API contract shape with a string amount', () => {
      // A JSON number would reintroduce the float problem at the boundary.
      expect(Money.fromDecimal('285000.00', 'SAR').unwrap().toJSON()).toEqual({
        amount: '285000.00',
        currency: 'SAR',
      })
    })

    it('round-trips through its decimal form', () => {
      const original = Money.fromDecimal('1234.567', 'KWD').unwrap()
      const restored = Money.fromDecimal(original.toDecimal(), 'KWD').unwrap()
      expect(restored.equals(original)).toBe(true)
    })
  })
})
