import { isBypassingTenantScope, type Database } from '@buildflow/database'
import { detectShortages, type BalanceFacts, type Shortage } from '../domain/shortage'

/**
 * The shortage sweep — raises `stock.shortage_detected` for every scope whose
 * plan outruns what is on site. docs/02 §3.9
 *
 * DELIBERATELY UNLIKE budget.exceeded, which alerts once per baseline because
 * crossing a budget is an EVENT. A shortage is a STATE: if the tiles are still
 * short tomorrow, that is still worth saying, and a system that mentions it
 * once and then goes quiet is how a site discovers the problem on delivery
 * day. So the sweep re-raises on each run, and dedupes only against events the
 * relay has not yet drained — enough to stop a backed-up queue filling with
 * copies, not enough to silence a live problem.
 */

export const SHORTAGE_DETECTED = 'stock.shortage_detected'

export interface ShortageSummary {
  scopesChecked: number
  shortages: (Shortage & { companyId: string })[]
  raised: number
}

const fixed4 = (value: unknown): string => Number(String(value)).toFixed(4)

export class ShortageSweep {
  constructor(
    private readonly db: Database,
    private readonly generateId: () => string,
  ) {}

  /** Cross-tenant by design, guarded exactly like the reconciliation. */
  async run(at: Date): Promise<ShortageSummary> {
    if (!isBypassingTenantScope()) {
      throw new Error(
        'ShortageSweep.run() must run inside runWithoutTenantScope() — it checks every ' +
          "tenant's plans by design.",
      )
    }

    // Only scopes with a plan can be short; the rest cannot be measured.
    const rows = await this.db.materialBalance.findMany({
      where: { plannedQuantity: { gt: 0 } },
    })

    const shortages: (Shortage & { companyId: string })[] = []
    let raised = 0

    for (const row of rows) {
      const facts: BalanceFacts = {
        unitId: row.unitId,
        unitStageId: row.unitStageId,
        materialId: row.materialId,
        uom: row.uom,
        plannedQuantity: fixed4(row.plannedQuantity),
        usedQuantity: fixed4(row.usedQuantity),
        remainingQuantity: fixed4(row.remainingQuantity),
      }
      const [shortage] = detectShortages([facts])
      if (!shortage) continue
      shortages.push({ ...shortage, companyId: row.companyId })

      // Do not queue a copy of something the relay has not delivered yet.
      const undelivered = await this.db.outboxEvent.count({
        where: {
          aggregateType: 'MaterialBalance',
          aggregateId: row.id,
          eventType: SHORTAGE_DETECTED,
          publishedAt: null,
        },
      })
      if (undelivered > 0) continue

      await this.db.outboxEvent.create({
        data: {
          id: this.generateId(),
          companyId: row.companyId,
          aggregateType: 'MaterialBalance',
          aggregateId: row.id,
          eventType: SHORTAGE_DETECTED,
          eventVersion: 1,
          actorId: null,
          payload: shortage as never,
          occurredAt: at,
        },
      })
      raised += 1
    }

    return { scopesChecked: rows.length, shortages, raised }
  }
}

export interface ShortageRow extends Shortage {
  materialSku: string
  materialNameEn: string
  materialNameAr: string
}

/** The per-unit shortage list a site screen reads. */
export class ShortageQueries {
  constructor(private readonly db: Database) {}

  async forUnit(unitId: string): Promise<readonly ShortageRow[]> {
    const rows = await this.db.materialBalance.findMany({
      where: { unitId, plannedQuantity: { gt: 0 } },
    })
    const shortages = detectShortages(
      rows.map((row) => ({
        unitId: row.unitId,
        unitStageId: row.unitStageId,
        materialId: row.materialId,
        uom: row.uom,
        plannedQuantity: fixed4(row.plannedQuantity),
        usedQuantity: fixed4(row.usedQuantity),
        remainingQuantity: fixed4(row.remainingQuantity),
      })),
    )
    if (shortages.length === 0) return []

    const materials = await this.db.material.findMany({
      where: { id: { in: [...new Set(shortages.map((shortage) => shortage.materialId))] } },
      select: { id: true, sku: true, nameEn: true, nameAr: true },
    })
    const byId = new Map(materials.map((material) => [material.id, material]))

    return shortages.map((shortage) => {
      const material = byId.get(shortage.materialId)
      return {
        ...shortage,
        materialSku: material?.sku ?? shortage.materialId,
        materialNameEn: material?.nameEn ?? '',
        materialNameAr: material?.nameAr ?? '',
      }
    })
  }
}
