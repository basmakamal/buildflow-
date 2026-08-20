import { describe, expect, it } from 'vitest'
import {
  directionFor,
  foldBalance,
  reversalOf,
  validateQuantity,
  wouldGoNegative,
  type MovementRecord,
  type StockMovementType,
} from '../src/domain/stock'

/**
 * The fold is the reconciliation function: the projection table is only ever a
 * cache of what these assertions pin down. A bug here is not a wrong number on
 * a screen — it is a wrong number that reconciliation then agrees with.
 */

const at = (day: number) => new Date(Date.UTC(2026, 7, day))

const move = (
  type: StockMovementType,
  direction: 'in' | 'out',
  quantity: string,
  over: Partial<MovementRecord> = {},
): MovementRecord => ({
  type,
  direction,
  quantity,
  totalCost: null,
  occurredAt: at(1),
  reversalOfMovementId: null,
  ...over,
})

describe('directionFor', () => {
  it('fixes the direction for every type except adjustment', () => {
    for (const [type, expected] of [
      ['purchase_receipt', 'in'],
      ['opening_balance', 'in'],
      ['transfer_in', 'in'],
      ['consumption', 'out'],
      ['wastage', 'out'],
      ['return_to_supplier', 'out'],
      ['transfer_out', 'out'],
    ] as const) {
      const result = directionFor(type)
      expect(result.isOk(), type).toBe(true)
      if (result.isOk()) expect(result.value).toBe(expected)
    }
  })

  /** Letting a caller record a consumption as `in` is how stock inflates. */
  it('rejects a direction that contradicts the type', () => {
    const result = directionFor('consumption', 'in')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('STOCK_DIRECTION_CONTRADICTS_TYPE')
  })

  it('requires an explicit direction for adjustments', () => {
    const missing = directionFor('adjustment')
    expect(missing.isErr()).toBe(true)
    if (missing.isErr()) expect(missing.error.code).toBe('STOCK_DIRECTION_REQUIRED')

    const explicit = directionFor('adjustment', 'out')
    expect(explicit.isOk()).toBe(true)
    if (explicit.isOk()) expect(explicit.value).toBe('out')
  })
})

describe('validateQuantity', () => {
  it('rejects zero, negatives and junk', () => {
    for (const bad of ['0', '0.0000', '-5', 'ten', '1.23456']) {
      expect(validateQuantity(bad).isErr(), bad).toBe(true)
    }
    expect(validateQuantity('12.5').isOk()).toBe(true)
  })
})

describe('foldBalance', () => {
  it('computes remaining as Σ(in) − Σ(out), never a counter', () => {
    const balance = foldBalance([
      move('opening_balance', 'in', '20'),
      move('purchase_receipt', 'in', '100', { totalCost: '5500.0000' }),
      move('consumption', 'out', '35.5'),
      move('wastage', 'out', '2.25'),
      move('return_to_supplier', 'out', '10'),
    ])

    expect(balance.purchased).toBe('120.0000')
    expect(balance.used).toBe('35.5000')
    expect(balance.wasted).toBe('2.2500')
    expect(balance.returned).toBe('10.0000')
    expect(balance.remaining).toBe('72.2500')
    expect(balance.actualCost).toBe('5500.0000')
  })

  it('keeps transfers and adjustments out of the purchase/use buckets', () => {
    const balance = foldBalance([
      move('purchase_receipt', 'in', '50'),
      move('transfer_out', 'out', '20'),
      move('transfer_in', 'in', '5'),
      move('adjustment', 'out', '1.5'),
    ])
    // A transfer is not a purchase and not a use; an adjustment corrects the
    // count, not the consumption story.
    expect(balance.purchased).toBe('50.0000')
    expect(balance.used).toBe('0.0000')
    expect(balance.remaining).toBe('33.5000')
  })

  /**
   * The property reversals exist for: a reversed consumption restores both
   * `remaining` AND `used`, because it keeps the original's type. Recording it
   * as an adjustment would fix the count while leaving the consumption story
   * overstated — the projection would balance and still lie.
   */
  it('a reversal restores the same bucket it came from', () => {
    const balance = foldBalance([
      move('purchase_receipt', 'in', '100', { totalCost: '5500.0000' }),
      move('consumption', 'out', '30'),
      // reversal of that consumption: same type, flipped direction
      move('consumption', 'in', '30', { reversalOfMovementId: 'm-2' }),
    ])
    expect(balance.used).toBe('0.0000')
    expect(balance.remaining).toBe('100.0000')
  })

  it('a reversed receipt takes its cost back out', () => {
    const balance = foldBalance([
      move('purchase_receipt', 'in', '100', { totalCost: '5500.0000' }),
      move('purchase_receipt', 'out', '100', {
        totalCost: '5500.0000',
        reversalOfMovementId: 'm-1',
      }),
    ])
    expect(balance.purchased).toBe('0.0000')
    expect(balance.actualCost).toBe('0.0000')
    expect(balance.remaining).toBe('0.0000')
  })

  it('tracks the latest occurredAt, not the last array element', () => {
    const balance = foldBalance([
      move('purchase_receipt', 'in', '10', { occurredAt: at(5) }),
      move('consumption', 'out', '1', { occurredAt: at(3) }),
    ])
    expect(balance.lastMovementAt).toEqual(at(5))
  })

  it('folds an empty ledger to zeros', () => {
    const balance = foldBalance([])
    expect(balance.remaining).toBe('0.0000')
    expect(balance.lastMovementAt).toBeNull()
  })
})

describe('wouldGoNegative', () => {
  const balance = foldBalance([move('purchase_receipt', 'in', '10')])

  it('flags an outbound larger than remaining', () => {
    expect(wouldGoNegative(balance, move('consumption', 'out', '10.0001'))).toBe(true)
    expect(wouldGoNegative(balance, move('consumption', 'out', '10'))).toBe(false)
  })

  it('never flags inbound', () => {
    expect(wouldGoNegative(balance, move('purchase_receipt', 'in', '999'))).toBe(false)
  })
})

describe('reversalOf', () => {
  it('flips direction, keeps type and magnitude, and points back', () => {
    const reversal = reversalOf({
      id: 'm-9',
      type: 'consumption',
      direction: 'out',
      quantity: '12.5000',
      totalCost: null,
      uom: 'm2',
    })
    expect(reversal).toEqual({
      type: 'consumption',
      direction: 'in',
      quantity: '12.5000',
      totalCost: null,
      uom: 'm2',
      reversalOfMovementId: 'm-9',
    })
  })
})
