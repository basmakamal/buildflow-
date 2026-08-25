import { describe, expect, it } from 'vitest'
import { detectShortages, shortageOf, type BalanceFacts } from '../src/domain/shortage'

/**
 * "Will we run out before we finish?" — not "did we buy everything". The two
 * answers diverge the moment anything is wasted, returned or transferred,
 * which on a real site is most weeks.
 */

const balance = (over: Partial<BalanceFacts> = {}): BalanceFacts => ({
  unitId: 'unit-305',
  unitStageId: null,
  materialId: 'mat-tiles',
  uom: 'm2',
  plannedQuantity: '100.0000',
  usedQuantity: '0.0000',
  remainingQuantity: '100.0000',
  ...over,
})

describe('the shortage question', () => {
  it('is silent when what is on site covers what is still needed', () => {
    expect(shortageOf(balance())).toBeNull()
    // 60 used, 40 still needed, 45 on site — comfortable.
    expect(
      shortageOf(balance({ usedQuantity: '60.0000', remainingQuantity: '45.0000' })),
    ).toBeNull()
  })

  it('reports the shortfall between what is still needed and what is there', () => {
    // 100 planned, 60 used → 40 still needed; only 15 on site.
    const shortage = shortageOf(balance({ usedQuantity: '60.0000', remainingQuantity: '15.0000' }))
    expect(shortage).toMatchObject({
      stillNeeded: '40.0000',
      available: '15.0000',
      shortfall: '25.0000',
    })
  })

  it('counts breakage that was already replaced as no shortage at all', () => {
    // 100 planned, 110 purchased, 10 wasted → 100 on site, nothing used yet.
    // "planned − purchased" would say fine; so does this, but for the right
    // reason — and the next case is where the two part company.
    expect(shortageOf(balance({ remainingQuantity: '100.0000' }))).toBeNull()

    // 100 planned, 100 purchased, 10 wasted → 90 on site. Purchased covers
    // the plan on paper, yet the site is 10 short of finishing.
    const real = shortageOf(balance({ remainingQuantity: '90.0000' }))
    expect(real?.shortfall).toBe('10.0000')
  })

  it('says nothing about a scope nobody planned', () => {
    // Ad-hoc material bought without a plan is not "short" — no promise was
    // made, and reporting it would bury the shortages that matter.
    expect(shortageOf(balance({ plannedQuantity: '0.0000', remainingQuantity: '0' }))).toBeNull()
  })

  it('says nothing once the plan is fully consumed', () => {
    // Over-consumption is the ledger's business; there is no future demand
    // left to be short of.
    expect(
      shortageOf(balance({ usedQuantity: '120.0000', remainingQuantity: '0.0000' })),
    ).toBeNull()
  })

  it('handles a negative remaining — the site is already in the hole', () => {
    const shortage = shortageOf(balance({ usedQuantity: '30.0000', remainingQuantity: '-5.0000' }))
    expect(shortage).toMatchObject({ stillNeeded: '70.0000', shortfall: '75.0000' })
  })
})

describe('detectShortages', () => {
  it('returns the worst shortfall first — the one to act on today', () => {
    const shortages = detectShortages([
      balance({ materialId: 'small', usedQuantity: '90.0000', remainingQuantity: '5.0000' }),
      balance({ materialId: 'none' }),
      balance({ materialId: 'big', usedQuantity: '10.0000', remainingQuantity: '0.0000' }),
    ])
    expect(shortages.map((shortage) => shortage.materialId)).toEqual(['big', 'small'])
    expect(shortages[0]!.shortfall).toBe('90.0000')
    expect(shortages[1]!.shortfall).toBe('5.0000')
  })

  it('keeps stage scopes apart', () => {
    const shortages = detectShortages([
      balance({ unitStageId: 'stage-1', usedQuantity: '100.0000', remainingQuantity: '0' }),
      balance({ unitStageId: 'stage-2', usedQuantity: '50.0000', remainingQuantity: '10.0000' }),
    ])
    expect(shortages).toHaveLength(1)
    expect(shortages[0]).toMatchObject({ unitStageId: 'stage-2', shortfall: '40.0000' })
  })
})
