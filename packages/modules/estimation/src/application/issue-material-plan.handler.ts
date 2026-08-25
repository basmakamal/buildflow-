import {
  type DomainError,
  type IdGenerator,
  type Result,
  type UnitOfMeasure,
  type UserId,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import type { BoqSnapshot } from '../domain/boq'

/**
 * Issuing the material plan — where an estimate becomes a commitment.
 * docs/02 §1.1 ("an approved BOQ issues a material plan"), docs/04 §2.9
 *
 * This is the seam Phase 3 has been waiting on. `material_balances` has
 * carried `planned_quantity` since the stock ledger landed with nothing to
 * fill it, so every planned-versus-actual number has been half a comparison
 * and shortage detection had nothing to detect against. An approved BOQ is
 * what supplies the other half.
 *
 * The planned quantity is the line quantity INCLUDING waste, because the site
 * has to buy the waste too — planning the net quantity and then discovering
 * the 10 % on delivery day is how a job stops.
 *
 * LINES WITHOUT A MATERIAL ARE REPORTED, NOT DROPPED. A work item priced from
 * a rate card need not name a catalogue material (labour-only items rarely
 * do), and those lines simply cannot be planned. Saying so is the difference
 * between a plan that is honestly partial and one that is quietly wrong.
 */

export interface PlanRow {
  id: string
  unitId: string
  unitStageId: string | null
  materialId: string
  boqId: string
  boqLineId: string
  plannedQuantity: string
  uom: UnitOfMeasure
  plannedUnitCost: string
  currency: string
  issuedAt: Date
  issuedBy: UserId
}

export interface UnplannableLine {
  boqLineId: string
  workItemCode: string
  reason: string
}

export interface BudgetBuckets {
  materialBudget: string
  labourBudget: string
  equipmentBudget: string
  overheadBudget: string
}

export interface IssuedPlan {
  rows: PlanRow[]
  unplannable: UnplannableLine[]
  /** The baseline this BOQ justifies, ready for the procurement budget. */
  buckets: BudgetBuckets
  currency: string
}

/**
 * Derives the plan rows and the budget baseline from an approved BOQ.
 *
 * The BUDGET is derived from the same document in the same breath, because a
 * plan and a baseline that come from different BOQ versions are a variance
 * report nobody can explain. The buckets are the BOQ's own totals; overhead
 * is the money the BOQ already added on top of them.
 */
export function issueMaterialPlan(
  boq: BoqSnapshot,
  issuedBy: UserId,
  issuedAt: Date,
  ids: IdGenerator,
): Result<IssuedPlan, DomainError> {
  if (boq.status !== 'approved') {
    return err(
      validationError('BOQ_NOT_APPROVED', 'Only an approved BOQ commits the site to quantities', {
        status: boq.status,
      }),
    )
  }

  const sectionStages = new Map(
    boq.sections.map((section) => [section.id, section.stageTemplateId]),
  )

  const rows: PlanRow[] = []
  const unplannable: UnplannableLine[] = []
  for (const line of boq.lines) {
    if (!line.materialId) {
      unplannable.push({
        boqLineId: line.id,
        workItemCode: line.workItemCode,
        reason: 'This line prices work, not a catalogue material',
      })
      continue
    }
    rows.push({
      id: ids.next<'MaterialPlanId'>(),
      unitId: boq.unitId,
      unitStageId: sectionStages.get(line.sectionId) ?? null,
      materialId: line.materialId,
      boqId: String(boq.id),
      boqLineId: line.id,
      plannedQuantity: line.quantityWithWaste,
      uom: line.uom,
      plannedUnitCost: line.materialRate,
      currency: boq.currency,
      issuedAt,
      issuedBy,
    })
  }

  if (rows.length === 0) {
    return err(
      validationError(
        'BOQ_HAS_NO_MATERIALS',
        'No line on this BOQ names a catalogue material, so there is nothing to plan',
        { lines: boq.lines.length },
      ),
    )
  }

  // The overhead the BOQ added is the difference between what it charges
  // before tax and what the work itself costs — stated rather than recomputed
  // from a percentage, so the baseline matches the document to the halala.
  const overhead = (Number(boq.preTaxTotal) - Number(boq.subtotal)).toFixed(2)

  return ok({
    rows,
    unplannable,
    buckets: {
      materialBudget: boq.materialTotal,
      labourBudget: boq.labourTotal,
      equipmentBudget: boq.equipmentTotal,
      overheadBudget: Number(overhead) > 0 ? overhead : '0',
    },
    currency: boq.currency,
  })
}

export interface PlannedTotal {
  unitId: string
  unitStageId: string | null
  materialId: string
  uom: UnitOfMeasure
  plannedQuantity: string
  plannedCost: string
  currency: string
}

/**
 * Sums plan rows into the per-(unit, stage, material) totals the balance
 * projection carries. Quantities add in scaled integers — a plan summed with
 * floats is a plan that disagrees with its own lines by the third decimal.
 */
export function foldPlannedTotals(rows: readonly PlanRow[]): PlannedTotal[] {
  const totals = new Map<string, { row: PlanRow; quantity: bigint; cost: bigint }>()

  for (const row of rows) {
    const key = `${row.unitId}|${row.unitStageId ?? ''}|${row.materialId}`
    const quantity = toScaled(row.plannedQuantity)
    // quantity(4dp) × unitCost(4dp) → 8 dp, divided back to 4.
    const cost = (quantity * toScaled(row.plannedUnitCost) + 5_000n) / 10_000n
    const existing = totals.get(key)
    if (existing) {
      existing.quantity += quantity
      existing.cost += cost
    } else {
      totals.set(key, { row, quantity, cost })
    }
  }

  return [...totals.values()].map((entry) => ({
    unitId: entry.row.unitId,
    unitStageId: entry.row.unitStageId,
    materialId: entry.row.materialId,
    uom: entry.row.uom,
    plannedQuantity: fromScaled(entry.quantity),
    plannedCost: fromScaled(entry.cost),
    currency: entry.row.currency,
  }))
}

const toScaled = (decimal: string): bigint => {
  const [whole = '0', fraction = ''] = decimal.split('.')
  return BigInt(whole + fraction.padEnd(4, '0').slice(0, 4))
}

const fromScaled = (scaled: bigint): string => {
  const digits = scaled.toString().padStart(5, '0')
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`
}
