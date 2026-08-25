import { describe, expect, it } from 'vitest'
import type { BoqId, CompanyId, UserId } from '@buildflow/core'
import { Boq, type NewLineInput } from '../src/domain/boq'
import { diffBoqs } from '../src/domain/boq-diff'

/**
 * The two invariants: approved is immutable, and every number is derived —
 * line totals extend once per part, buckets sum exactly to the subtotal, and
 * the overhead → profit → tax chain rounds once per step so the printed
 * document survives a hand check.
 */

const AT = new Date('2026-08-25T08:00:00Z')
const APPROVER = 'user-1' as UserId
let counter = 0
const nextId = () => `id-${String(++counter)}`

const create = (over: Partial<Parameters<typeof Boq.create>[0]> = {}) =>
  Boq.create({
    id: 'boq-1' as BoqId,
    companyId: 'co-1' as CompanyId,
    unitId: 'unit-305',
    versionNumber: 1,
    name: 'Unit 305 · Premium',
    finishingLevel: 'premium',
    rateCardId: 'card-1',
    pricingDate: new Date('2026-08-01T00:00:00Z'),
    currency: 'SAR',
    overheadPercentage: '10',
    profitPercentage: '20',
    taxPercentage: '15',
    notes: null,
    generatedBy: 'manual',
    ...over,
  })

const boq = (over: Partial<Parameters<typeof Boq.create>[0]> = {}): Boq => {
  const result = create(over)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

const LINE: Omit<NewLineInput, 'sectionId'> = {
  roomId: 'room-1',
  materialId: null,
  workItemCode: 'wk_paint_walls',
  descriptionEn: 'Wall painting',
  descriptionAr: 'دهان جدران',
  uom: 'm2',
  quantity: '100',
  wasteFactor: '10',
  materialRate: '8',
  labourRate: '7',
  equipmentRate: '0',
  source: 'manual',
  ruleCode: null,
  formulaEvaluated: null,
  formulaInputs: null,
  sortOrder: 0,
}

const withSection = (document: Boq): string => {
  const sectionId = nextId()
  const added = document.addSection({
    id: sectionId,
    stageTemplateId: null,
    code: 'painting',
    titleEn: 'Painting',
    titleAr: 'الدهانات',
    sortOrder: 0,
  })
  if (added.isErr()) throw new Error(added.error.message)
  return sectionId
}

describe('derived money', () => {
  it('extends, buckets, and chains overhead → profit → tax, rounding once per step', () => {
    const document = boq()
    const sectionId = withSection(document)

    const added = document.addLine({ ...LINE, sectionId }, nextId)
    expect(added.isOk()).toBe(true)

    const line = document.lines[0]!
    // 100 × 1.10 = 110; 110×8 = 880.00, 110×7 = 770.00 → 1650.00
    expect(line.quantityWithWaste).toBe('110.0000')
    expect(line.lineTotal).toBe('1650.00')

    const totals = document.totals
    expect(totals.materialTotal).toBe('880.00')
    expect(totals.labourTotal).toBe('770.00')
    expect(totals.subtotal).toBe('1650.00')
    // +10% = 1815.00 → +20% = 2178.00 → +15% = 2504.70
    expect(totals.grandTotal).toBe('2504.70')

    expect(document.sections[0]!.subtotal).toBe('1650.00')
  })

  it('a rule line without its provenance is refused — auditability is contractual', () => {
    const document = boq()
    const sectionId = withSection(document)
    const result = document.addLine(
      { ...LINE, sectionId, source: 'rule', ruleCode: null, formulaEvaluated: null },
      nextId,
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BOQ_RULE_LINE_NEEDS_PROVENANCE')
  })
})

describe('overrides', () => {
  it('overrules the quantity with a reason and KEEPS the provenance', () => {
    const document = boq()
    const sectionId = withSection(document)
    const added = document.addLine(
      {
        ...LINE,
        sectionId,
        source: 'rule',
        ruleCode: 'est_paint_wall_area',
        formulaEvaluated: 'perimeter_m(24) * height_m(3) = 72.0000',
        formulaInputs: { perimeter_m: '24', height_m: '3' },
      },
      nextId,
    )
    if (added.isErr()) throw new Error(added.error.message)

    const overridden = document.overrideLineQuantity(
      added.value,
      '95',
      'Site measurement: alcove the plan does not show',
    )
    expect(overridden.isOk()).toBe(true)

    const line = document.lines[0]!
    expect(line.quantity).toBe('95')
    expect(line.quantityWithWaste).toBe('104.5000')
    expect(line.isOverridden).toBe(true)
    expect(line.formulaEvaluated).toContain('perimeter_m(24)')
    expect(document.totals.subtotal).toBe('1567.50') // 104.5 × 15
  })

  it('an override without a reason is refused', () => {
    const document = boq()
    const sectionId = withSection(document)
    const added = document.addLine({ ...LINE, sectionId }, nextId)
    if (added.isErr()) throw new Error(added.error.message)
    const result = document.overrideLineQuantity(added.value, '95', '   ')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BOQ_OVERRIDE_NEEDS_REASON')
  })
})

describe('the document lifecycle', () => {
  const reviewed = (): Boq => {
    const document = boq()
    const sectionId = withSection(document)
    const added = document.addLine({ ...LINE, sectionId }, nextId)
    if (added.isErr()) throw new Error(added.error.message)
    const submitted = document.submit()
    if (submitted.isErr()) throw new Error(submitted.error.message)
    return document
  }

  it('an empty BOQ quantifies nothing and cannot submit', () => {
    const result = boq().submit()
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BOQ_NEEDS_LINES')
  })

  it('approved is immutable — content changes are refused', () => {
    const document = reviewed()
    expect(document.approve(APPROVER, AT).isOk()).toBe(true)
    expect(document.status).toBe('approved')

    const sectionId = document.sections[0]!.id
    const addAfter = document.addLine({ ...LINE, sectionId }, nextId)
    expect(addAfter.isErr()).toBe(true)
    if (addAfter.isErr()) expect(addAfter.error.code).toBe('BOQ_NOT_DRAFT')

    const overrideAfter = document.overrideLineQuantity(document.lines[0]!.id, '90', 'why')
    expect(overrideAfter.isErr()).toBe(true)
    if (overrideAfter.isErr()) expect(overrideAfter.error.code).toBe('BOQ_NOT_EDITABLE')
  })

  it('overriding during review is legal — that is what review is for', () => {
    const document = reviewed()
    const result = document.overrideLineQuantity(
      document.lines[0]!.id,
      '90',
      'QS corrected the take-off',
    )
    expect(result.isOk()).toBe(true)
  })

  it('a new version copies content as a fresh draft and leaves the source alone', () => {
    const document = reviewed()
    expect(document.approve(APPROVER, AT).isOk()).toBe(true)

    const next = document.nextVersion('boq-2' as BoqId, nextId)
    expect(next.isOk()).toBe(true)
    if (!next.isOk()) return

    expect(next.value.versionNumber).toBe(2)
    expect(next.value.status).toBe('draft')
    expect(next.value.lines).toHaveLength(1)
    expect(next.value.lines[0]!.id).not.toBe(document.lines[0]!.id)
    expect(document.status).toBe('approved')

    // The predecessor is superseded only when its successor approves.
    expect(document.supersededBy('boq-2').isOk()).toBe(true)
    expect(document.status).toBe('superseded')
    expect(document.toSnapshot().supersededByBoqId).toBe('boq-2')
  })

  it('a draft does not version — it just edits', () => {
    const result = boq().nextVersion('boq-2' as BoqId, nextId)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BOQ_VERSION_FROM_TERMINAL_ONLY')
  })
})

describe('the version diff', () => {
  it('reports added, removed and changed lines plus the totals delta', () => {
    const v1 = boq()
    const v1Section = withSection(v1)
    const keep = v1.addLine({ ...LINE, sectionId: v1Section }, nextId)
    if (keep.isErr()) throw new Error(keep.error.message)
    const dropped = v1.addLine(
      { ...LINE, sectionId: v1Section, workItemCode: 'wk_skirting', quantity: '40' },
      nextId,
    )
    if (dropped.isErr()) throw new Error(dropped.error.message)

    const v2 = boq({ id: 'boq-2' as BoqId, versionNumber: 2 })
    const v2Section = withSection(v2)
    const changed = v2.addLine({ ...LINE, sectionId: v2Section, quantity: '120' }, nextId)
    if (changed.isErr()) throw new Error(changed.error.message)
    const added = v2.addLine(
      { ...LINE, sectionId: v2Section, workItemCode: 'wk_gypsum_ceiling', quantity: '30' },
      nextId,
    )
    if (added.isErr()) throw new Error(added.error.message)

    const diff = diffBoqs(v1.toSnapshot(), v2.toSnapshot())
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toMatchObject({ workItemCode: 'wk_gypsum_ceiling' })
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]).toMatchObject({ workItemCode: 'wk_skirting' })
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toMatchObject({
      workItemCode: 'wk_paint_walls',
      before: { quantityWithWaste: '110.0000' },
      after: { quantityWithWaste: '132.0000' },
    })
    expect(diff.totals.before.subtotal).not.toBe(diff.totals.after.subtotal)
  })
})
