import { describe, expect, it } from 'vitest'
import type { BudgetId, CompanyId, UserId } from '@buildflow/core'
import { Budget, type BudgetBuckets } from '../src/domain/budget'

/**
 * The append-only revision discipline: the total is derived from the buckets
 * and stored, revision 2+ must say why it exists, a revision that changes
 * nothing is refused, and the currency of a scope never drifts mid-history.
 */

const AT = new Date('2026-08-22T08:00:00Z')
const LATER = new Date('2026-08-25T08:00:00Z')
const ACTOR = 'user-1' as UserId

const BUCKETS: BudgetBuckets = {
  materialBudget: '52000',
  labourBudget: '23500.50',
  equipmentBudget: '3200',
  overheadBudget: '1299.50',
}

const baseline = (over: Partial<Parameters<typeof Budget.baseline>[0]> = {}) =>
  Budget.baseline({
    id: 'bud-1' as BudgetId,
    companyId: 'co-1' as CompanyId,
    unitId: 'unit-305',
    unitStageId: null,
    boqId: null,
    buckets: BUCKETS,
    currency: 'SAR',
    baselineAt: AT,
    approvedBy: ACTOR,
    ...over,
  })

const budget = (over: Partial<Parameters<typeof Budget.baseline>[0]> = {}): Budget => {
  const result = baseline(over)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

describe('the baseline', () => {
  it('derives the total from the buckets and stores everything money-formatted', () => {
    const snapshot = budget().toSnapshot()
    expect(snapshot.totalBudget).toBe('80000.00')
    expect(snapshot.materialBudget).toBe('52000.00')
    expect(snapshot.labourBudget).toBe('23500.50')
    expect(snapshot.revision).toBe(1)
    expect(snapshot.revisionReason).toBeNull()
  })

  it('allows a zero bucket but refuses a zero budget', () => {
    const zeroBucket = baseline({
      buckets: { ...BUCKETS, equipmentBudget: '0' },
    })
    expect(zeroBucket.isOk()).toBe(true)

    const zeroBudget = baseline({
      buckets: {
        materialBudget: '0',
        labourBudget: '0',
        equipmentBudget: '0',
        overheadBudget: '0',
      },
    })
    expect(zeroBudget.isErr()).toBe(true)
    if (zeroBudget.isErr()) expect(zeroBudget.error.code).toBe('BUDGET_MUST_BE_POSITIVE')
  })

  it('refuses a negative or malformed bucket', () => {
    const result = baseline({ buckets: { ...BUCKETS, labourBudget: '-500' } })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BUDGET_AMOUNT_INVALID')
  })

  it('refuses sub-minor-unit precision — 0.005 SAR is not money anyone can pay', () => {
    const result = baseline({ buckets: { ...BUCKETS, overheadBudget: '1299.5050' } })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MONEY_PRECISION_EXCEEDED')
  })

  it('refuses an unknown currency', () => {
    const result = baseline({ currency: 'XXX' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('INVALID_CURRENCY')
  })
})

describe('revisions', () => {
  it('increments the revision, keeps the currency, and records the reason', () => {
    const revised = budget().revise({
      id: 'bud-2' as BudgetId,
      buckets: { ...BUCKETS, materialBudget: '67000' },
      boqId: null,
      baselineAt: LATER,
      approvedBy: ACTOR,
      revisionReason: 'Client upgraded to premium porcelain',
    })
    expect(revised.isOk()).toBe(true)
    if (!revised.isOk()) return

    const snapshot = revised.value.toSnapshot()
    expect(snapshot.revision).toBe(2)
    expect(snapshot.totalBudget).toBe('95000.00')
    expect(snapshot.currency).toBe('SAR')
    expect(snapshot.unitId).toBe('unit-305')
    expect(snapshot.revisionReason).toBe('Client upgraded to premium porcelain')
  })

  it('demands the honest answer — no reason, no revision', () => {
    const result = budget().revise({
      id: 'bud-2' as BudgetId,
      buckets: { ...BUCKETS, materialBudget: '67000' },
      boqId: null,
      baselineAt: LATER,
      approvedBy: ACTOR,
      revisionReason: '   ',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BUDGET_REVISION_NEEDS_REASON')
  })

  it('refuses a revision that changes nothing', () => {
    const result = budget().revise({
      id: 'bud-2' as BudgetId,
      // '52000' and '52000.00' are the same money — normalisation happens
      // before the comparison, so cosmetic reformatting is not a change.
      buckets: { ...BUCKETS, materialBudget: '52000.00' },
      boqId: null,
      baselineAt: LATER,
      approvedBy: ACTOR,
      revisionReason: 'no-op attempt',
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BUDGET_REVISION_UNCHANGED')
  })

  it('attaching the BOQ is a real change even with identical numbers', () => {
    const result = budget().revise({
      id: 'bud-2' as BudgetId,
      buckets: BUCKETS,
      boqId: 'boq-7',
      baselineAt: LATER,
      approvedBy: ACTOR,
      revisionReason: 'Baseline now backed by approved BOQ v3',
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.toSnapshot().boqId).toBe('boq-7')
  })

  it('chains: revision 3 builds on revision 2', () => {
    const second = budget().revise({
      id: 'bud-2' as BudgetId,
      buckets: { ...BUCKETS, materialBudget: '67000' },
      boqId: null,
      baselineAt: LATER,
      approvedBy: ACTOR,
      revisionReason: 'scope change',
    })
    if (second.isErr()) throw new Error(second.error.message)

    const third = second.value.revise({
      id: 'bud-3' as BudgetId,
      buckets: { ...BUCKETS, materialBudget: '70000' },
      boqId: null,
      baselineAt: LATER,
      approvedBy: ACTOR,
      revisionReason: 'steel price jump',
    })
    expect(third.isOk()).toBe(true)
    if (third.isOk()) expect(third.value.toSnapshot().revision).toBe(3)
  })
})

describe('three-decimal currencies', () => {
  it('formats KWD at three places — 1 KWD is 1000 fils, exactly', () => {
    const snapshot = budget({
      currency: 'KWD',
      buckets: {
        materialBudget: '5200.505',
        labourBudget: '100',
        equipmentBudget: '0',
        overheadBudget: '0',
      },
    }).toSnapshot()
    expect(snapshot.materialBudget).toBe('5200.505')
    expect(snapshot.totalBudget).toBe('5300.505')
  })
})
