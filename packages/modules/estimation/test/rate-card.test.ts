import { describe, expect, it } from 'vitest'
import type { CompanyId, RateCardId } from '@buildflow/core'
import { RateCard, coversDate, pickRateCard } from '../src/domain/rate-card'

/**
 * The lifecycle IS the pricing discipline: items editable in draft, frozen on
 * activation, new prices are a new card. And resolution is deterministic —
 * two people pricing the same unit on the same date get the same answer.
 */

let counter = 0
const nextId = () => `item-${String(++counter)}`

const ITEM = {
  materialId: null,
  workItemCode: 'wk_paint_walls',
  descriptionEn: 'Wall painting',
  descriptionAr: 'دهان جدران',
  uom: 'm2' as const,
  materialRate: '9.5000',
  labourRate: '8.0000',
  equipmentRate: '0',
  productivityPerDay: '45',
}

const create = (over: Partial<Parameters<typeof RateCard.create>[0]> = {}) =>
  RateCard.create({
    id: 'card-1' as RateCardId,
    companyId: 'co-1' as CompanyId,
    name: 'SA Baseline',
    countryCode: 'SA',
    city: null,
    currency: 'SAR',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
    isDefault: false,
    ...over,
  })

const card = (over: Partial<Parameters<typeof RateCard.create>[0]> = {}): RateCard => {
  const result = create(over)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

describe('creation', () => {
  it('starts as an empty draft', () => {
    const snapshot = card().toSnapshot()
    expect(snapshot.status).toBe('draft')
    expect(snapshot.items).toHaveLength(0)
  })

  it('refuses an inverted effective window', () => {
    const result = create({
      effectiveFrom: new Date('2026-06-01T00:00:00Z'),
      effectiveTo: new Date('2026-01-01T00:00:00Z'),
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RATE_CARD_DATES_INVERTED')
  })

  it('refuses an unknown currency and a malformed country', () => {
    expect(create({ currency: 'XXX' }).isErr()).toBe(true)
    expect(create({ countryCode: 'saudi' }).isErr()).toBe(true)
  })
})

describe('items', () => {
  it('replaces the set while draft', () => {
    const draft = card()
    expect(draft.replaceItems([ITEM], nextId).isOk()).toBe(true)
    expect(draft.items).toHaveLength(1)
    expect(draft.items[0]).toMatchObject({ workItemCode: 'wk_paint_walls' })
  })

  it('refuses duplicates, bad codes, and free work', () => {
    const draft = card()

    const duplicate = draft.replaceItems([ITEM, { ...ITEM }], nextId)
    expect(duplicate.isErr()).toBe(true)
    if (duplicate.isErr()) expect(duplicate.error.code).toBe('RATE_ITEM_DUPLICATE')

    const badCode = draft.replaceItems([{ ...ITEM, workItemCode: 'Paint Walls!' }], nextId)
    expect(badCode.isErr()).toBe(true)
    if (badCode.isErr()) expect(badCode.error.code).toBe('RATE_ITEM_CODE_INVALID')

    const free = draft.replaceItems(
      [{ ...ITEM, materialRate: '0', labourRate: '0', equipmentRate: '0' }],
      nextId,
    )
    expect(free.isErr()).toBe(true)
    if (free.isErr()) expect(free.error.code).toBe('RATE_ITEM_ZERO')
  })

  it('freezes items on activation — new prices are a new card', () => {
    const active = card()
    expect(active.replaceItems([ITEM], nextId).isOk()).toBe(true)
    expect(active.activate().isOk()).toBe(true)

    const result = active.replaceItems([{ ...ITEM, labourRate: '9' }], nextId)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RATE_CARD_NOT_DRAFT')
  })
})

describe('lifecycle', () => {
  it('an empty rate card prices nothing and cannot activate', () => {
    const result = card().activate()
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RATE_CARD_NEEDS_ITEMS')
  })

  it('walks draft → active → archived, once each', () => {
    const walked = card()
    expect(walked.replaceItems([ITEM], nextId).isOk()).toBe(true)
    expect(walked.activate().isOk()).toBe(true)
    expect(walked.activate().isErr()).toBe(true)
    expect(walked.archive().isOk()).toBe(true)
    expect(walked.archive().isErr()).toBe(true)
    expect(walked.status).toBe('archived')
  })
})

describe('resolution', () => {
  const resolvable = (over: Record<string, unknown>) => ({
    status: 'active' as const,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null as Date | null,
    city: null as string | null,
    isDefault: false,
    name: 'card',
    ...over,
  })

  it('windows are boundary-inclusive and archived cards never resolve', () => {
    const windowed = resolvable({
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-06-30T00:00:00Z'),
    })
    expect(coversDate(windowed, new Date('2026-01-01T00:00:00Z'))).toBe(true)
    expect(coversDate(windowed, new Date('2026-06-30T00:00:00Z'))).toBe(true)
    expect(coversDate(windowed, new Date('2026-07-01T00:00:00Z'))).toBe(false)
    expect(coversDate(windowed, new Date('2025-12-31T00:00:00Z'))).toBe(false)
    expect(coversDate(resolvable({ status: 'archived' }), new Date('2026-03-01T00:00:00Z'))).toBe(
      false,
    )
  })

  it('prefers the city match, then the default, then the freshest window', () => {
    const country = resolvable({ name: 'country', isDefault: true })
    const riyadh = resolvable({ name: 'riyadh', city: 'Riyadh' })
    const fresher = resolvable({
      name: 'fresher',
      effectiveFrom: new Date('2026-05-01T00:00:00Z'),
    })

    const date = new Date('2026-06-01T00:00:00Z')
    // City beats everything, case-insensitively.
    expect(pickRateCard([country, riyadh, fresher], date, 'riyadh')?.name).toBe('riyadh')
    // No city asked: the default beats the fresher non-default.
    expect(pickRateCard([country, riyadh, fresher], date, null)?.name).toBe('country')
    // No default in play: the freshest window wins.
    expect(pickRateCard([riyadh, fresher], date, null)?.name).toBe('fresher')
    // Nothing covers a date before every window.
    expect(pickRateCard([country], new Date('2025-01-01T00:00:00Z'), null)).toBeNull()
  })
})
