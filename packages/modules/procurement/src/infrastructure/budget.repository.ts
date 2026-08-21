import { Prisma, type Database } from '@buildflow/database'
import type { BudgetId, CompanyId, UserId } from '@buildflow/core'
import { Budget } from '../domain/budget'

/**
 * Budget persistence — append-only, so this repository has `create` and reads,
 * and nothing else. There is no `save`: a revision that could be edited after
 * the fact is not a baseline, it is an argument waiting to happen.
 *
 * The unique key (companyId, unitId, stageKey, revision) is the concurrency
 * control: two users revising the same scope at once both compute revision
 * n+1, one insert wins, the other hits the constraint and surfaces as a 409.
 * No version column needed — the database does the arbitration.
 */

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

/** '' pins uniqueness for the stage-less row — MySQL permits repeated NULLs. */
const toStageKey = (unitStageId: string | null): string => unitStageId ?? ''

export class PrismaBudgetRepository {
  constructor(private readonly db: Database) {}

  /** The current baseline for a scope: its highest revision. */
  async latestForScope(unitId: string, unitStageId: string | null): Promise<Budget | null> {
    const row = await this.db.budget.findFirst({
      where: { unitId, stageKey: toStageKey(unitStageId) },
      orderBy: { revision: 'desc' },
    })
    if (!row) return null
    return restore(row)
  }

  /** False when another writer inserted this revision first — a 409, not a 500. */
  async create(budget: Budget): Promise<boolean> {
    const snapshot = budget.toSnapshot()
    try {
      await this.db.budget.create({
        data: {
          id: snapshot.id,
          unitId: snapshot.unitId,
          unitStageId: snapshot.unitStageId,
          boqId: snapshot.boqId,
          materialBudget: snapshot.materialBudget,
          labourBudget: snapshot.labourBudget,
          equipmentBudget: snapshot.equipmentBudget,
          overheadBudget: snapshot.overheadBudget,
          totalBudget: snapshot.totalBudget,
          currency: snapshot.currency,
          baselineAt: snapshot.baselineAt,
          revision: snapshot.revision,
          approvedBy: snapshot.approvedBy,
          revisionReason: snapshot.revisionReason,
          stageKey: toStageKey(snapshot.unitStageId),
        } as never,
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false
      }
      throw error
    }
    return true
  }
}

interface BudgetRow {
  id: string
  companyId: string
  unitId: string
  unitStageId: string | null
  boqId: string | null
  materialBudget: unknown
  labourBudget: unknown
  equipmentBudget: unknown
  overheadBudget: unknown
  totalBudget: unknown
  currency: string
  baselineAt: Date
  revision: number
  approvedBy: string
  revisionReason: string | null
}

function restore(row: BudgetRow): Budget {
  return Budget.restore({
    id: row.id as BudgetId,
    companyId: row.companyId as CompanyId,
    unitId: row.unitId,
    unitStageId: row.unitStageId,
    boqId: row.boqId,
    materialBudget: fixed(row.materialBudget, 2),
    labourBudget: fixed(row.labourBudget, 2),
    equipmentBudget: fixed(row.equipmentBudget, 2),
    overheadBudget: fixed(row.overheadBudget, 2),
    totalBudget: fixed(row.totalBudget, 2),
    currency: row.currency,
    baselineAt: row.baselineAt,
    revision: row.revision,
    approvedBy: row.approvedBy as UserId,
    revisionReason: row.revisionReason,
  })
}

export interface BudgetRevisionRow {
  id: string
  unitStageId: string | null
  boqId: string | null
  materialBudget: string
  labourBudget: string
  equipmentBudget: string
  overheadBudget: string
  totalBudget: string
  currency: string
  baselineAt: Date
  revision: number
  approvedBy: string
  revisionReason: string | null
}

export class BudgetQueries {
  constructor(private readonly db: Database) {}

  /**
   * The unit's currency, or null if the unit does not exist (or is deleted).
   * A budget in a currency the unit is not costed in would make every variance
   * a conversion question, so the route refuses the mismatch up front.
   */
  async unitCurrency(unitId: string): Promise<string | null> {
    const unit = await this.db.unit.findFirst({
      where: { id: unitId, deletedAt: null },
      select: { currency: true },
    })
    return unit?.currency ?? null
  }

  /** Every revision of every scope on the unit — the full baseline history. */
  async history(unitId: string): Promise<readonly BudgetRevisionRow[]> {
    const rows = await this.db.budget.findMany({
      where: { unitId },
      orderBy: [{ stageKey: 'asc' }, { revision: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      unitStageId: row.unitStageId,
      boqId: row.boqId,
      materialBudget: fixed(row.materialBudget, 2),
      labourBudget: fixed(row.labourBudget, 2),
      equipmentBudget: fixed(row.equipmentBudget, 2),
      overheadBudget: fixed(row.overheadBudget, 2),
      totalBudget: fixed(row.totalBudget, 2),
      currency: row.currency,
      baselineAt: row.baselineAt,
      revision: row.revision,
      approvedBy: row.approvedBy,
      revisionReason: row.revisionReason,
    }))
  }
}
