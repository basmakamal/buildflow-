import type { Database } from '@buildflow/database'
import type { PlanRow, PlannedTotal } from '../application/issue-material-plan.handler'

/**
 * Material-plan persistence, and the projection of planned quantities into
 * material_balances.
 *
 * Writing the plan is idempotent by the (companyId, boqLineId) key:
 * `createMany` with skipDuplicates means re-issuing an approved BOQ writes
 * nothing new rather than doubling the plan. That matters because "issue the
 * plan" is exactly the button someone presses twice.
 */

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class PrismaMaterialPlanRepository {
  constructor(private readonly db: Database) {}

  /** How many rows this call actually added — 0 means it was already issued. */
  async issue(rows: readonly PlanRow[]): Promise<number> {
    if (rows.length === 0) return 0
    const result = await this.db.materialPlan.createMany({
      data: rows.map((row) => ({
        id: row.id,
        unitId: row.unitId,
        unitStageId: row.unitStageId,
        materialId: row.materialId,
        boqId: row.boqId,
        boqLineId: row.boqLineId,
        plannedQuantity: row.plannedQuantity,
        uom: row.uom,
        plannedUnitCost: row.plannedUnitCost,
        currency: row.currency,
        issuedAt: row.issuedAt,
        issuedBy: row.issuedBy,
      })) as never,
      skipDuplicates: true,
    })
    return result.count
  }

  async issuedForBoq(boqId: string): Promise<number> {
    return this.db.materialPlan.count({ where: { boqId } })
  }

  /**
   * Writes the planned totals into the balance projection.
   *
   * SETS rather than adds: the plan is the authority on what was planned, so
   * the projection takes its value outright. An incremental add would double
   * on the second issue of a re-approved BOQ, which is precisely the bug the
   * ledger-replay discipline exists to avoid everywhere else.
   */
  async project(
    companyId: string,
    totals: readonly PlannedTotal[],
    generateId: () => string,
    at: Date,
  ): Promise<void> {
    for (const total of totals) {
      const stageKey = total.unitStageId ?? ''
      const existing = await this.db.materialBalance.findFirst({
        where: { unitId: total.unitId, stageKey, materialId: total.materialId },
        select: { id: true },
      })

      if (existing) {
        await this.db.materialBalance.update({
          where: { id: existing.id },
          data: {
            plannedQuantity: total.plannedQuantity,
            plannedCost: total.plannedCost,
            currency: total.currency,
            recalculatedAt: at,
          },
        })
        continue
      }
      await this.db.materialBalance.create({
        data: {
          id: generateId(),
          companyId,
          unitId: total.unitId,
          unitStageId: total.unitStageId,
          stageKey,
          materialId: total.materialId,
          plannedQuantity: total.plannedQuantity,
          plannedCost: total.plannedCost,
          uom: total.uom,
          currency: total.currency,
          recalculatedAt: at,
        },
      })
    }
  }
}

export interface MaterialPlanRow {
  id: string
  unitId: string
  unitStageId: string | null
  materialId: string
  boqId: string
  boqLineId: string
  plannedQuantity: string
  uom: string
  plannedUnitCost: string
  currency: string
  issuedAt: Date
}

export class MaterialPlanQueries {
  constructor(private readonly db: Database) {}

  async forUnit(unitId: string): Promise<readonly MaterialPlanRow[]> {
    const rows = await this.db.materialPlan.findMany({
      where: { unitId },
      orderBy: [{ issuedAt: 'desc' }],
      take: 500,
    })
    return rows.map((row) => ({
      id: row.id,
      unitId: row.unitId,
      unitStageId: row.unitStageId,
      materialId: row.materialId,
      boqId: row.boqId,
      boqLineId: row.boqLineId,
      plannedQuantity: fixed(row.plannedQuantity, 4),
      uom: row.uom,
      plannedUnitCost: fixed(row.plannedUnitCost, 4),
      currency: row.currency,
      issuedAt: row.issuedAt,
    }))
  }
}
