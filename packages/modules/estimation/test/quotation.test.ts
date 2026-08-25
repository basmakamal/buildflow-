import { describe, expect, it } from 'vitest'
import type { BoqId, CompanyId, QuotationId } from '@buildflow/core'
import { Quotation } from '../src/domain/quotation'
import { buildQuotationDocument } from '../src/domain/quotation-document'
import type { BoqSnapshot } from '../src/domain/boq'

/**
 * The money chain and its ORDER: markup, then discount, then tax — last and
 * once, on what is actually payable. And the bilingual document, tested as
 * content, because an Arabic quotation that quietly prints English labels is
 * exactly the defect nobody catches in review.
 */

const VALID_UNTIL = new Date('2026-09-30T00:00:00Z')
const BEFORE = new Date('2026-09-01T10:00:00Z')
/** 17:00 on the last valid day — still inside the offer. */
const LAST_DAY = new Date('2026-09-30T17:00:00Z')
const AFTER = new Date('2026-10-01T00:00:01Z')

const create = (over: Partial<Parameters<typeof Quotation.create>[0]> = {}) =>
  Quotation.create({
    id: 'quo-1' as QuotationId,
    companyId: 'co-1' as CompanyId,
    boqId: 'boq-1',
    unitId: 'unit-305',
    clientId: null,
    quotationNumber: 'QT-00001',
    basis: '100000.00',
    currency: 'SAR',
    validUntil: VALID_UNTIL,
    markupPercentage: '10',
    discountAmount: '0',
    taxPercentage: '15',
    language: 'ar',
    notes: null,
    ...over,
  })

const quotation = (over: Partial<Parameters<typeof Quotation.create>[0]> = {}): Quotation => {
  const result = create(over)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

/** A sent quotation, ready for the tracking transitions. */
const sent = (over: Partial<Parameters<typeof Quotation.create>[0]> = {}): Quotation => {
  const result = quotation(over)
  const outcome = result.send(BEFORE, null)
  if (outcome.isErr()) throw new Error(outcome.error.message)
  return result
}

describe('the money chain', () => {
  it('applies markup, then discount, then tax — last and once', () => {
    const totals = quotation({ discountAmount: '5000' }).toSnapshot()
    // 100,000 basis + 10% markup = 110,000; − 5,000 discount = 105,000 net;
    // 15% VAT on the NET = 15,750; payable 120,750.
    expect(totals.basisAmount).toBe('100000.00')
    expect(totals.markupAmount).toBe('10000.00')
    expect(totals.netAmount).toBe('105000.00')
    expect(totals.taxAmount).toBe('15750.00')
    expect(totals.totalAmount).toBe('120750.00')
  })

  it('taxes the discounted figure, not the pre-discount one', () => {
    const withDiscount = quotation({ discountAmount: '10000' }).toSnapshot()
    const without = quotation({ discountAmount: '0' }).toSnapshot()
    // Taxing before the discount would leave tax unchanged at 16,500.
    expect(without.taxAmount).toBe('16500.00')
    expect(withDiscount.taxAmount).toBe('15000.00')
  })

  it('refuses a discount larger than the offer', () => {
    const result = create({ discountAmount: '200000' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('QUOTATION_DISCOUNT_EXCEEDS_TOTAL')
  })

  it('refuses a BOQ that prices nothing', () => {
    const result = create({ basis: '0' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('QUOTATION_BASIS_EMPTY')
  })

  it('rounds each step once — 3 dp currencies stay exact', () => {
    const kwd = quotation({
      currency: 'KWD',
      basis: '1000.500',
      markupPercentage: '7.5',
      taxPercentage: '5',
    }).toSnapshot()
    expect(kwd.markupAmount).toBe('75.038')
    expect(kwd.netAmount).toBe('1075.538')
    expect(kwd.taxAmount).toBe('53.777')
    expect(kwd.totalAmount).toBe('1129.315')
  })
})

describe('the lifecycle', () => {
  it('walks draft → sent → viewed → accepted, stamping each moment once', () => {
    const document = quotation()
    expect(document.send(BEFORE, 'doc-1').isOk()).toBe(true)
    expect(document.status).toBe('sent')

    const firstView = new Date('2026-09-02T09:00:00Z')
    expect(document.markViewed(firstView).isOk()).toBe(true)
    expect(document.status).toBe('viewed')

    // A second open does not move the "when did they look at it" answer.
    expect(document.markViewed(new Date('2026-09-03T09:00:00Z')).isOk()).toBe(true)
    expect(document.viewedAt).toEqual(firstView)

    expect(document.accept(LAST_DAY).isOk()).toBe(true)
    expect(document.status).toBe('accepted')
    expect(document.toSnapshot().respondedAt).toEqual(LAST_DAY)
  })

  it('accepts on the last valid day and refuses the moment after', () => {
    expect(sent().accept(LAST_DAY).isOk()).toBe(true)

    const late = sent().accept(AFTER)
    expect(late.isErr()).toBe(true)
    if (late.isErr()) expect(late.error.code).toBe('QUOTATION_EXPIRED')
  })

  it('refuses to send an offer that is already stale', () => {
    const result = quotation().send(AFTER, null)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('QUOTATION_ALREADY_EXPIRED')
  })

  it('answers only once — an accepted quotation is a commitment', () => {
    const accepted = sent()
    expect(accepted.accept(BEFORE).isOk()).toBe(true)
    expect(accepted.reject(BEFORE).isErr()).toBe(true)
    // And it never expires: it stopped being an offer when it was accepted.
    const expiry = accepted.expire(AFTER)
    expect(expiry.isErr()).toBe(true)
    if (expiry.isErr()) expect(expiry.error.code).toBe('QUOTATION_NOT_OPEN')
  })

  it('expires only an open offer, and only once it is actually stale', () => {
    const early = sent().expire(BEFORE)
    expect(early.isErr()).toBe(true)
    if (early.isErr()) expect(early.error.code).toBe('QUOTATION_STILL_VALID')

    const stale = sent()
    expect(stale.expire(AFTER).isOk()).toBe(true)
    expect(stale.status).toBe('expired')
  })

  it('a draft is not viewable and a sent one is not re-sendable', () => {
    expect(quotation().markViewed(BEFORE).isErr()).toBe(true)
    expect(sent().send(BEFORE, null).isErr()).toBe(true)
  })
})

const BOQ: BoqSnapshot = {
  id: 'boq-1' as BoqId,
  companyId: 'co-1' as CompanyId,
  unitId: 'unit-305',
  versionNumber: 1,
  name: 'Unit 305',
  status: 'approved',
  finishingLevel: 'premium',
  packageId: null,
  packageVersion: null,
  rateCardId: 'card-1',
  pricingDate: new Date('2026-08-01T00:00:00Z'),
  currency: 'SAR',
  overheadPercentage: '10',
  profitPercentage: '20',
  taxPercentage: '15',
  materialTotal: '0',
  labourTotal: '0',
  equipmentTotal: '0',
  subtotal: '0',
  preTaxTotal: '100000.00',
  grandTotal: '0',
  approvedBy: null,
  approvedAt: null,
  supersededByBoqId: null,
  notes: null,
  generatedBy: 'rule_engine',
  sections: [
    {
      id: 's1',
      stageTemplateId: null,
      code: 'walls',
      titleEn: 'Walls',
      titleAr: 'الجدران',
      sortOrder: 0,
      subtotal: '1650.00',
    },
    {
      id: 's2',
      stageTemplateId: null,
      code: 'empty',
      titleEn: 'Empty',
      titleAr: 'فارغ',
      sortOrder: 1,
      subtotal: '0.00',
    },
  ],
  lines: [
    {
      id: 'l1',
      sectionId: 's1',
      roomId: 'r1',
      materialId: null,
      workItemCode: 'wk_paint_walls',
      descriptionEn: 'Wall painting — Bedroom 1',
      descriptionAr: 'دهان جدران — غرفة نوم ١',
      uom: 'm2',
      quantity: '100',
      wasteFactor: '10',
      quantityWithWaste: '110.0000',
      materialRate: '8.0000',
      labourRate: '7.0000',
      equipmentRate: '0.0000',
      lineTotal: '1650.00',
      source: 'rule',
      ruleCode: 'est_paint_wall_area',
      formulaEvaluated: 'perimeter_m(18) * height_m(3) = 54.0000',
      formulaInputs: { perimeter_m: '18' },
      isOverridden: false,
      overrideReason: null,
      sortOrder: 0,
    },
  ],
  version: 0,
}

describe('the bilingual document', () => {
  it('renders Arabic right-to-left with Arabic labels and line text', () => {
    const document = buildQuotationDocument(sent().toSnapshot(), BOQ, 'Unit 305', 'ar')
    expect(document.direction).toBe('rtl')
    expect(document.header.title).toBe('عرض سعر')
    expect(document.columns.quantity).toBe('الكمية')
    expect(document.sections[0]!.title).toBe('الجدران')
    expect(document.sections[0]!.lines[0]!.description).toBe('دهان جدران — غرفة نوم ١')
    expect(document.totals.at(-1)!.label).toBe('الإجمالي المستحق')
    expect(document.terms).toHaveLength(3)
  })

  it('renders the same numbers in English, left-to-right', () => {
    const document = buildQuotationDocument(sent().toSnapshot(), BOQ, 'Unit 305', 'en')
    expect(document.direction).toBe('ltr')
    expect(document.header.title).toBe('Quotation')
    expect(document.sections[0]!.lines[0]!.description).toBe('Wall painting — Bedroom 1')
    // The client sees ONE rate — the contractor's cost split stays in the BOQ.
    expect(document.sections[0]!.lines[0]!.unitRate).toBe('15.0000')
    expect(document.totals.at(-1)!.amount).toBe('126500.00')
  })

  it('omits sections with no lines and total rows worth nothing', () => {
    const noExtras = buildQuotationDocument(
      quotation({ markupPercentage: '0', discountAmount: '0', taxPercentage: '0' }).toSnapshot(),
      BOQ,
      'Unit 305',
      'en',
    )
    // The empty section never prints.
    expect(noExtras.sections).toHaveLength(1)
    // Only the subtotal and the payable line — no "Discount 0.00" to puzzle over.
    expect(noExtras.totals).toHaveLength(2)
    expect(noExtras.totals.map((row) => row.label)).toEqual(['Works subtotal', 'Total payable'])
  })

  it('marks the discount as a deduction and the payable line as the total', () => {
    const document = buildQuotationDocument(
      quotation({ discountAmount: '5000' }).toSnapshot(),
      BOQ,
      'Unit 305',
      'en',
    )
    expect(document.totals.find((row) => row.isDeduction)).toMatchObject({
      label: 'Discount',
      amount: '5000.00',
    })
    expect(document.totals.filter((row) => row.isTotal)).toHaveLength(1)
  })
})
