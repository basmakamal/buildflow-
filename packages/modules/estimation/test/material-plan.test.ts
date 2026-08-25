import { describe, expect, it } from 'vitest'
import type { BoqId, CompanyId, IdGenerator, UserId } from '@buildflow/core'
import {
  foldPlannedTotals,
  issueMaterialPlan,
} from '../src/application/issue-material-plan.handler'
import type { BoqLine, BoqSnapshot } from '../src/domain/boq'

/**
 * An approved BOQ becomes a commitment: plan rows carrying the waste, a budget
 * baseline from the same document, and an honest account of the lines that
 * could not be planned at all.
 */

const AT = new Date('2026-08-25T08:00:00Z')
const ACTOR = 'user-1' as UserId

let counter = 0
const ids: IdGenerator = { next: () => `id-${String(++counter)}` as never }

const line = (over: Partial<BoqLine> = {}): BoqLine => ({
  id: `line-${String(++counter)}`,
  sectionId: 's1',
  roomId: 'room-1',
  materialId: 'mat-tiles',
  workItemCode: 'wk_floor_porcelain',
  descriptionEn: 'Porcelain flooring',
  descriptionAr: 'أرضيات بورسلين',
  uom: 'm2',
  quantity: '100.0000',
  wasteFactor: '10',
  quantityWithWaste: '110.0000',
  materialRate: '78.0000',
  labourRate: '35.0000',
  equipmentRate: '0.0000',
  lineTotal: '12430.00',
  source: 'rule',
  ruleCode: 'est_tile_area',
  formulaEvaluated: 'area_m2(100) = 100.0000',
  formulaInputs: { area_m2: '100' },
  isOverridden: false,
  overrideReason: null,
  sortOrder: 0,
  ...over,
})

const boq = (over: Partial<BoqSnapshot> = {}): BoqSnapshot => ({
  id: 'boq-1' as BoqId,
  companyId: 'co-1' as CompanyId,
  unitId: 'unit-305',
  versionNumber: 2,
  name: 'Unit 305',
  status: 'approved',
  finishingLevel: 'premium',
  packageId: 'pkg-1',
  packageVersion: 1,
  rateCardId: 'card-1',
  pricingDate: new Date('2026-08-01T00:00:00Z'),
  currency: 'SAR',
  overheadPercentage: '10',
  profitPercentage: '0',
  taxPercentage: '15',
  materialTotal: '8580.00',
  labourTotal: '3850.00',
  equipmentTotal: '0.00',
  subtotal: '12430.00',
  preTaxTotal: '13673.00',
  grandTotal: '15723.95',
  approvedBy: ACTOR,
  approvedAt: AT,
  supersededByBoqId: null,
  notes: null,
  generatedBy: 'rule_engine',
  sections: [
    {
      id: 's1',
      stageTemplateId: 'stage-flooring',
      code: 'flooring',
      titleEn: 'Flooring',
      titleAr: 'الأرضيات',
      sortOrder: 0,
      subtotal: '12430.00',
    },
  ],
  lines: [line()],
  version: 0,
  ...over,
})

describe('issuing the plan', () => {
  it('plans the quantity INCLUDING waste — the site buys the waste too', () => {
    const issued = issueMaterialPlan(boq(), ACTOR, AT, ids)
    expect(issued.isOk()).toBe(true)
    if (!issued.isOk()) return

    expect(issued.value.rows).toHaveLength(1)
    expect(issued.value.rows[0]).toMatchObject({
      unitId: 'unit-305',
      materialId: 'mat-tiles',
      // 100 net, 110 with the 10 % waste the BOQ line already carried.
      plannedQuantity: '110.0000',
      plannedUnitCost: '78.0000',
      currency: 'SAR',
      issuedBy: ACTOR,
    })
  })

  it('carries the section stage onto the plan, so a stage can be measured', () => {
    const issued = issueMaterialPlan(boq(), ACTOR, AT, ids)
    if (!issued.isOk()) throw new Error(issued.error.message)
    expect(issued.value.rows[0]!.unitStageId).toBe('stage-flooring')
  })

  it('refuses a BOQ that is not approved', () => {
    const result = issueMaterialPlan(boq({ status: 'draft' }), ACTOR, AT, ids)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BOQ_NOT_APPROVED')
  })

  it('reports lines that price work rather than material — never drops them', () => {
    const issued = issueMaterialPlan(
      boq({ lines: [line(), line({ materialId: null, workItemCode: 'wk_paint_walls' })] }),
      ACTOR,
      AT,
      ids,
    )
    if (!issued.isOk()) throw new Error(issued.error.message)

    expect(issued.value.rows).toHaveLength(1)
    expect(issued.value.unplannable).toHaveLength(1)
    expect(issued.value.unplannable[0]).toMatchObject({ workItemCode: 'wk_paint_walls' })
  })

  it('refuses when nothing on the BOQ names a material at all', () => {
    const result = issueMaterialPlan(boq({ lines: [line({ materialId: null })] }), ACTOR, AT, ids)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('BOQ_HAS_NO_MATERIALS')
  })
})

describe('the budget baseline', () => {
  it('takes the buckets from the same document, overhead stated not recomputed', () => {
    const issued = issueMaterialPlan(boq(), ACTOR, AT, ids)
    if (!issued.isOk()) throw new Error(issued.error.message)

    // 13,673.00 pre-tax − 12,430.00 of work = 1,243.00 of overhead, which is
    // exactly what the BOQ charged; deriving it from "10 %" could round apart.
    expect(issued.value.buckets).toEqual({
      materialBudget: '8580.00',
      labourBudget: '3850.00',
      equipmentBudget: '0.00',
      overheadBudget: '1243.00',
    })
    expect(issued.value.currency).toBe('SAR')
  })

  it('never reports a negative overhead', () => {
    const issued = issueMaterialPlan(
      boq({ preTaxTotal: '12000.00', subtotal: '12430.00' }),
      ACTOR,
      AT,
      ids,
    )
    if (!issued.isOk()) throw new Error(issued.error.message)
    expect(issued.value.buckets.overheadBudget).toBe('0')
  })
})

describe('folding into the projection', () => {
  it('sums lines of the same material in the same scope', () => {
    const issued = issueMaterialPlan(
      boq({
        lines: [
          line({ quantityWithWaste: '110.0000', materialRate: '78.0000' }),
          line({ quantityWithWaste: '55.5000', materialRate: '78.0000', roomId: 'room-2' }),
        ],
      }),
      ACTOR,
      AT,
      ids,
    )
    if (!issued.isOk()) throw new Error(issued.error.message)

    const totals = foldPlannedTotals(issued.value.rows)
    expect(totals).toHaveLength(1)
    expect(totals[0]).toMatchObject({
      materialId: 'mat-tiles',
      plannedQuantity: '165.5000',
      // 110 × 78 = 8,580 and 55.5 × 78 = 4,329 → 12,909 exactly.
      plannedCost: '12909.0000',
    })
  })

  it('keeps different materials and different stages apart', () => {
    const issued = issueMaterialPlan(
      boq({
        sections: [
          {
            id: 's1',
            stageTemplateId: 'stage-a',
            code: 'a',
            titleEn: 'A',
            titleAr: 'أ',
            sortOrder: 0,
            subtotal: '0',
          },
          {
            id: 's2',
            stageTemplateId: 'stage-b',
            code: 'b',
            titleEn: 'B',
            titleAr: 'ب',
            sortOrder: 1,
            subtotal: '0',
          },
        ],
        lines: [
          line({ sectionId: 's1', materialId: 'mat-tiles' }),
          line({ sectionId: 's1', materialId: 'mat-grout' }),
          line({ sectionId: 's2', materialId: 'mat-tiles' }),
        ],
      }),
      ACTOR,
      AT,
      ids,
    )
    if (!issued.isOk()) throw new Error(issued.error.message)
    expect(foldPlannedTotals(issued.value.rows)).toHaveLength(3)
  })
})
