import { describe, expect, it } from 'vitest'
import type { CompanyId, InvoiceId, UserId } from '@buildflow/core'
import { Invoice, type InvoiceSnapshot } from '../src/domain/invoice'

/**
 * The exact-sum invariant is the whole reason CostAllocation exists as a
 * concept: Σ(allocations) = total to the minor unit, remainder to the largest
 * allocation, deterministically. Everything else here is the payment state
 * machine and the void-not-delete rule.
 */

const AT = new Date('2026-08-20T08:00:00Z')
const ACTOR = 'user-1' as UserId
let counter = 0
const nextId = () => `alloc-${String(++counter)}`

const create = (over: Partial<Parameters<typeof Invoice.create>[0]> = {}) =>
  Invoice.create({
    id: 'inv-1' as InvoiceId,
    companyId: 'co-1' as CompanyId,
    supplierId: 'sup-1',
    poId: null,
    invoiceNumber: 'INV-100',
    invoiceDate: AT,
    dueDate: null,
    taxRate: '15',
    currency: 'SAR',
    notes: null,
    lines: [
      {
        id: 'l1',
        materialId: 'mat-1',
        description: 'Porcelain 60x60',
        quantity: '70',
        uom: 'box',
        unitPrice: '79.2000',
      },
    ],
    ...over,
  })

const invoice = (over: Partial<Parameters<typeof Invoice.create>[0]> = {}): Invoice => {
  const result = create(over)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

describe('derived money', () => {
  it('derives subtotal, VAT and total from the lines', () => {
    const snapshot = invoice().toSnapshot()
    // 70 × 79.20 = 5544.00 · 15% VAT = 831.60 · total 6375.60
    expect(snapshot.subtotal).toBe('5544.00')
    expect(snapshot.taxAmount).toBe('831.60')
    expect(snapshot.total).toBe('6375.60')
  })

  it('rejects a tax rate above 100', () => {
    const result = create({ taxRate: '101' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('INVOICE_TAX_RATE_INVALID')
  })
})

describe('payments', () => {
  it('walks unpaid → partially_paid → paid and stamps settlement', () => {
    const inv = invoice()
    expect(inv.recordPayment('3000', 'bank_transfer', AT).isOk()).toBe(true)
    expect(inv.paymentStatus).toBe('partially_paid')

    expect(inv.recordPayment('3375.60', 'bank_transfer', AT).isOk()).toBe(true)
    expect(inv.paymentStatus).toBe('paid')
    expect(inv.paidAmount).toBe('6375.60')
    expect(inv.toSnapshot().paidAt).toEqual(AT)
  })

  it('refuses an overpayment rather than tracking a credit', () => {
    const inv = invoice()
    const result = inv.recordPayment('6375.61', 'cash', AT)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PAYMENT_EXCEEDS_TOTAL')
    // The refused payment must not have moved anything.
    expect(inv.paymentStatus).toBe('unpaid')
    expect(inv.paidAmount).toBe('0.00')
  })

  it('refuses payment against a settled or void invoice', () => {
    const settled = invoice()
    settled.recordPayment('6375.60', 'cash', AT)
    expect(settled.recordPayment('1', 'cash', AT).isErr()).toBe(true)

    const voided = invoice()
    voided.void('duplicate entry')
    const result = voided.recordPayment('1', 'cash', AT)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('INVOICE_IS_VOID')
  })
})

describe('void, not delete', () => {
  it('voids with a reason — even after payment', () => {
    const inv = invoice()
    inv.recordPayment('6375.60', 'cash', AT)
    // Deletion after payment is forbidden by design; void is the exit.
    expect(inv.void('supplier issued a credit note').isOk()).toBe(true)
    expect(inv.paymentStatus).toBe('void')
    expect(inv.voidReason).toBe('supplier issued a credit note')
  })

  it('requires the reason', () => {
    const result = invoice().void('   ')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('VOID_NEEDS_REASON')
  })
})

describe('allocation by percentages', () => {
  it('sums EXACTLY to the total, remainder on the largest allocation', () => {
    const inv = invoice()
    // 6375.60 split 33.33 / 33.33 / 33.34: naive per-part rounding loses or
    // invents halalas; the invariant says the set must sum exactly.
    const result = inv.allocateByPercentages(
      [
        { unitId: 'u1', unitStageId: null, percentage: '33.33' },
        { unitId: 'u2', unitStageId: null, percentage: '33.33' },
        { unitId: 'u3', unitStageId: null, percentage: '33.34' },
      ],
      ACTOR,
      AT,
      nextId,
    )
    expect(result.isOk()).toBe(true)

    const amounts = inv.allocations.map((a) => a.amount)
    const sum = amounts.reduce((total, amount) => total + Math.round(Number(amount) * 100), 0)
    expect(sum).toBe(637560)

    // Two halalas of remainder: the FIRST goes to u3 (largest share), the
    // second to u1 (earliest of the tied). Deterministic, and the largest is
    // favoured — docs/02 §3.9.
    const byUnit = new Map(inv.allocations.map((a) => [a.unitId, a.amount]))
    expect(byUnit.get('u3')).toBe('2125.63')
    expect(byUnit.get('u1')).toBe('2124.99')
    expect(byUnit.get('u2')).toBe('2124.98')
  })

  it('is deterministic — the same split twice places the remainder identically', () => {
    const split = () => {
      const inv = invoice()
      inv.allocateByPercentages(
        [
          { unitId: 'u1', unitStageId: null, percentage: '50' },
          { unitId: 'u2', unitStageId: null, percentage: '25' },
          { unitId: 'u3', unitStageId: null, percentage: '25' },
        ],
        ACTOR,
        AT,
        nextId,
      )
      return inv.allocations.map((a) => `${a.unitId}:${a.amount}`)
    }
    expect(split()).toEqual(split())
  })

  it('preserves the caller ordering in the stored set', () => {
    const inv = invoice()
    inv.allocateByPercentages(
      [
        { unitId: 'small', unitStageId: null, percentage: '10' },
        { unitId: 'large', unitStageId: null, percentage: '90' },
      ],
      ACTOR,
      AT,
      nextId,
    )
    // Sorted internally for the remainder rule, returned in caller order.
    expect(inv.allocations.map((a) => a.unitId)).toEqual(['small', 'large'])
  })

  it('rejects percentages that do not total 100', () => {
    const result = invoice().allocateByPercentages(
      [
        { unitId: 'u1', unitStageId: null, percentage: '60' },
        { unitId: 'u2', unitStageId: null, percentage: '30' },
      ],
      ACTOR,
      AT,
      nextId,
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('ALLOCATION_MUST_TOTAL_100')
  })

  it('replaces the previous set rather than appending', () => {
    const inv = invoice()
    inv.allocateByPercentages(
      [{ unitId: 'u1', unitStageId: null, percentage: '100' }],
      ACTOR,
      AT,
      nextId,
    )
    inv.allocateByPercentages(
      [
        { unitId: 'u2', unitStageId: null, percentage: '50' },
        { unitId: 'u3', unitStageId: null, percentage: '50' },
      ],
      ACTOR,
      AT,
      nextId,
    )
    expect(inv.allocations.map((a) => a.unitId)).toEqual(['u2', 'u3'])
  })
})

describe('allocation by amounts', () => {
  it('accepts a set that sums exactly', () => {
    const inv = invoice()
    const result = inv.allocateByAmounts(
      [
        { unitId: 'u1', unitStageId: 's1', amount: '6000.00' },
        { unitId: 'u2', unitStageId: null, amount: '375.60' },
      ],
      ACTOR,
      AT,
      nextId,
    )
    expect(result.isOk()).toBe(true)
  })

  it('rejects a halala of drift', () => {
    const result = invoice().allocateByAmounts(
      [
        { unitId: 'u1', unitStageId: null, amount: '6000.00' },
        { unitId: 'u2', unitStageId: null, amount: '375.59' },
      ],
      ACTOR,
      AT,
      nextId,
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('ALLOCATION_SUM_MISMATCH')
  })

  it('refuses allocation on a void invoice', () => {
    const inv = invoice()
    inv.void('wrong supplier')
    const result = inv.allocateByAmounts(
      [{ unitId: 'u1', unitStageId: null, amount: '6375.60' }],
      ACTOR,
      AT,
      nextId,
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('INVOICE_IS_VOID')
  })
})

describe('round-trip', () => {
  it('restores exactly what it snapshots', () => {
    const inv = invoice()
    inv.recordPayment('1000', 'cash', AT)
    inv.allocateByPercentages(
      [{ unitId: 'u1', unitStageId: null, percentage: '100' }],
      ACTOR,
      AT,
      nextId,
    )
    const snapshot = inv.toSnapshot()
    expect(Invoice.restore(snapshot).toSnapshot()).toEqual(snapshot)
  })
})
