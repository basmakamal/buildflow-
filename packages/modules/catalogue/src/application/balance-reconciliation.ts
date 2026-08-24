import { isBypassingTenantScope, type Database } from '@buildflow/database'
import { foldBalance, type MovementRecord } from '../domain/stock'

/**
 * Nightly reconciliation: the ledger judges the projection. docs/04 §2.9
 *
 * material_balances is derived, never authoritative — allowed to be wrong
 * temporarily, never permanently. This job replays every scope's full ledger
 * through the SAME fold the write path uses, compares the projection row
 * field by field, repairs any drift, and reports it loudly: an outbox event
 * per drifted scope, so drift reaches the same alert channel as everything
 * else. The Phase 3 exit criterion is this job reporting ZERO drift over 30
 * days — a silent repair would defeat the measurement, which is why the
 * report is the point and the repair is the afterthought.
 */

export interface BalanceScope {
  companyId: string
  unitId: string
  unitStageId: string | null
  materialId: string
}

export interface DriftField {
  field: string
  expected: string
  found: string
}

export interface DriftReport {
  scope: BalanceScope
  fields: DriftField[]
  repaired: boolean
}

export interface ReconciliationSummary {
  scopesChecked: number
  drifts: DriftReport[]
  startedAt: Date
  finishedAt: Date
}

export const RECONCILIATION_DRIFT = 'stock.reconciliation_drift'

/** The five folded quantities plus cost — the fields the projection promises. */
const COMPARED_FIELDS = [
  ['purchasedQuantity', 'purchased'],
  ['usedQuantity', 'used'],
  ['wastedQuantity', 'wasted'],
  ['returnedQuantity', 'returned'],
  ['remainingQuantity', 'remaining'],
  ['actualCost', 'actualCost'],
] as const

const fixed4 = (value: unknown): string => Number(String(value)).toFixed(4)

export class BalanceReconciliation {
  constructor(
    private readonly db: Database,
    private readonly generateId: () => string,
  ) {}

  /**
   * Replays every known scope. Runs cross-tenant BY DESIGN — the same
   * legitimacy as the outbox relay, guarded the same way.
   */
  async run(): Promise<ReconciliationSummary> {
    if (!isBypassingTenantScope()) {
      throw new Error(
        'BalanceReconciliation.run() must run inside runWithoutTenantScope() — it replays ' +
          "every tenant's ledger by design.",
      )
    }

    const startedAt = new Date()

    // Scopes come from BOTH sides: a ledger scope missing its projection row is
    // drift, and so is a projection row whose ledger says nothing at all.
    const fromLedger = await this.db.stockMovement.groupBy({
      by: ['companyId', 'unitId', 'unitStageId', 'materialId'],
    })
    const fromProjection = await this.db.materialBalance.findMany({
      select: { companyId: true, unitId: true, unitStageId: true, materialId: true },
    })

    const scopes = new Map<string, BalanceScope>()
    for (const row of [...fromLedger, ...fromProjection]) {
      const scope: BalanceScope = {
        companyId: row.companyId,
        unitId: row.unitId,
        unitStageId: row.unitStageId,
        materialId: row.materialId,
      }
      scopes.set(
        `${scope.companyId} ${scope.unitId} ${scope.unitStageId ?? ''} ${scope.materialId}`,
        scope,
      )
    }

    const drifts: DriftReport[] = []
    for (const scope of scopes.values()) {
      const drift = await this.reconcileScope(scope)
      if (drift) drifts.push(drift)
    }

    return { scopesChecked: scopes.size, drifts, startedAt, finishedAt: new Date() }
  }

  private async reconcileScope(scope: BalanceScope): Promise<DriftReport | null> {
    const rows = await this.db.stockMovement.findMany({
      where: {
        companyId: scope.companyId,
        unitId: scope.unitId,
        unitStageId: scope.unitStageId,
        materialId: scope.materialId,
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    })

    const movements: MovementRecord[] = rows.map((row) => ({
      type: row.type,
      direction: row.direction,
      quantity: String(row.quantity),
      totalCost: row.totalCost === null ? null : String(row.totalCost),
      occurredAt: row.occurredAt,
      reversalOfMovementId: row.reversalOfMovementId,
    }))
    const expected = foldBalance(movements)

    const stageKey = scope.unitStageId ?? ''
    const balance = await this.db.materialBalance.findFirst({
      where: {
        companyId: scope.companyId,
        unitId: scope.unitId,
        stageKey,
        materialId: scope.materialId,
      },
    })

    const fields: DriftField[] = []
    if (balance) {
      for (const [column, folded] of COMPARED_FIELDS) {
        const found = fixed4(balance[column])
        const truth = fixed4(expected[folded])
        if (found !== truth) fields.push({ field: column, expected: truth, found })
      }
    } else {
      // No projection row. An empty ledger folding to zeros with no row is the
      // one honest absence; anything else is a missing projection.
      if (rows.length === 0) return null
      for (const [column, folded] of COMPARED_FIELDS) {
        fields.push({ field: column, expected: fixed4(expected[folded]), found: 'missing' })
      }
    }

    if (fields.length === 0) return null

    // Repair by replaying — the same discipline as the write path: never
    // incremental, never a patch of the one wrong field.
    const uom = rows[0]?.uom ?? balance?.uom
    const currency = rows[0]?.currency ?? balance?.currency ?? null
    if (uom) {
      const data = {
        purchasedQuantity: expected.purchased,
        usedQuantity: expected.used,
        wastedQuantity: expected.wasted,
        returnedQuantity: expected.returned,
        remainingQuantity: expected.remaining,
        actualCost: expected.actualCost,
        currency,
        uom,
        lastMovementAt: expected.lastMovementAt,
        recalculatedAt: new Date(),
      }
      if (balance) {
        await this.db.materialBalance.update({ where: { id: balance.id }, data })
      } else {
        await this.db.materialBalance.create({
          data: {
            id: this.generateId(),
            companyId: scope.companyId,
            unitId: scope.unitId,
            unitStageId: scope.unitStageId,
            stageKey,
            materialId: scope.materialId,
            ...data,
          },
        })
      }
    }

    // The alert. Tenant scope is bypassed here, so companyId is explicit.
    await this.db.outboxEvent.create({
      data: {
        id: this.generateId(),
        companyId: scope.companyId,
        aggregateType: 'MaterialBalance',
        aggregateId: balance?.id ?? scope.materialId,
        eventType: RECONCILIATION_DRIFT,
        eventVersion: 1,
        actorId: null,
        payload: {
          unitId: scope.unitId,
          unitStageId: scope.unitStageId,
          materialId: scope.materialId,
          fields,
        } as never,
        occurredAt: new Date(),
      },
    })

    return { scope, fields, repaired: uom !== undefined }
  }
}
