import { Prisma, type Database } from '@buildflow/database'
import type { UnitOfMeasure } from '@buildflow/core'
import {
  foldBalance,
  type MovementRecord,
  type StockDirection,
  type StockMovementType,
} from '../domain/stock'

/**
 * Ledger persistence.
 *
 * The interface is the enforcement: there is `append`, and there are reads.
 * No update, no delete — a caller holding this repository cannot express a
 * mutation of history, which is a stronger guarantee than a code-review rule
 * asking people not to. Corrections go through `append` as reversal entries.
 */

export interface NewMovement {
  id: string
  materialId: string
  unitId: string
  unitStageId: string | null
  roomId: string | null
  type: StockMovementType
  direction: StockDirection
  /** In the material's base unit, already converted at the boundary. */
  quantity: string
  uom: UnitOfMeasure
  unitCost: string | null
  totalCost: string | null
  currency: string | null
  referenceType: string | null
  referenceId: string | null
  reversalOfMovementId: string | null
  occurredAt: Date
  recordedBy: string
  source: 'web' | 'mobile' | 'api' | 'system'
  clientEventId: string
  note: string | null
}

export interface MovementRow extends NewMovement {
  createdAt: Date
}

export interface BalanceRow {
  unitId: string
  unitStageId: string | null
  materialId: string
  sku: string
  materialNameEn: string
  materialNameAr: string
  uom: UnitOfMeasure
  purchasedQuantity: string
  usedQuantity: string
  wastedQuantity: string
  returnedQuantity: string
  remainingQuantity: string
  actualCost: string
  currency: string | null
  lastMovementAt: Date | null
}

/** Appended, or found already present under the same client event id. */
export type AppendOutcome = { appended: true } | { appended: false; existingId: string }

export class PrismaStockLedger {
  constructor(private readonly db: Database) {}

  /**
   * Appends one movement, idempotently.
   *
   * The mobile outbox retries until acknowledged, so the same clientEventId
   * WILL arrive twice; the unique key turns the duplicate into a lookup rather
   * than phantom stock. Race-safe: two concurrent duplicates both hit the
   * constraint, one wins, the other reads the winner.
   */
  async append(movement: NewMovement): Promise<AppendOutcome> {
    try {
      await this.db.stockMovement.create({
        data: {
          id: movement.id,
          materialId: movement.materialId,
          unitId: movement.unitId,
          unitStageId: movement.unitStageId,
          roomId: movement.roomId,
          type: movement.type,
          direction: movement.direction,
          quantity: movement.quantity,
          uom: movement.uom,
          unitCost: movement.unitCost,
          totalCost: movement.totalCost,
          currency: movement.currency,
          referenceType: movement.referenceType,
          referenceId: movement.referenceId,
          reversalOfMovementId: movement.reversalOfMovementId,
          occurredAt: movement.occurredAt,
          recordedBy: movement.recordedBy,
          source: movement.source,
          clientEventId: movement.clientEventId,
          note: movement.note,
        } as never,
      })
      return { appended: true }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' // unique constraint
      ) {
        const existing = await this.db.stockMovement.findFirst({
          where: { clientEventId: movement.clientEventId },
          select: { id: true },
        })
        if (existing) return { appended: false, existingId: existing.id }
      }
      throw error
    }
  }

  async findById(id: string): Promise<MovementRow | null> {
    const row = await this.db.stockMovement.findFirst({ where: { id } })
    return row ? toMovementRow(row) : null
  }

  async isReversed(id: string): Promise<boolean> {
    return (await this.db.stockMovement.count({ where: { reversalOfMovementId: id } })) > 0
  }

  /** The full ledger for one (unit, material), oldest first — replay order. */
  async ledgerFor(unitId: string, materialId: string): Promise<readonly MovementRow[]> {
    const rows = await this.db.stockMovement.findMany({
      where: { unitId, materialId },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(toMovementRow)
  }

  async movements(filter: {
    unitId: string
    materialId?: string
    limit?: number
  }): Promise<readonly MovementRow[]> {
    const rows = await this.db.stockMovement.findMany({
      where: {
        unitId: filter.unitId,
        ...(filter.materialId ? { materialId: filter.materialId } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(filter.limit ?? 100, 500),
    })
    return rows.map(toMovementRow)
  }
}

/**
 * The projection over the ledger.
 *
 * `recalculate` replays the FULL ledger for one (unit, stage, material) through
 * the same fold reconciliation uses. Never incremental: an incremental
 * projection that misses one event is wrong forever, a replayed one is wrong
 * until the next write. Replay cost is bounded by one unit's history for one
 * material, which stays small.
 */
export class PrismaBalanceProjection {
  constructor(private readonly db: Database) {}

  async recalculate(
    companyId: string,
    unitId: string,
    unitStageId: string | null,
    materialId: string,
    uom: UnitOfMeasure,
    currency: string | null,
    generateId: () => string,
  ): Promise<void> {
    const rows = await this.db.stockMovement.findMany({
      where: { unitId, materialId, unitStageId },
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

    const balance = foldBalance(movements)
    // MySQL unique indexes permit repeated NULLs; '' pins uniqueness for the
    // stage-less balance row. See the schema comment on stageKey.
    const stageKey = unitStageId ?? ''

    const existing = await this.db.materialBalance.findFirst({
      where: { unitId, stageKey, materialId },
      select: { id: true },
    })

    const data = {
      purchasedQuantity: balance.purchased,
      usedQuantity: balance.used,
      wastedQuantity: balance.wasted,
      returnedQuantity: balance.returned,
      remainingQuantity: balance.remaining,
      actualCost: balance.actualCost,
      currency,
      uom,
      lastMovementAt: balance.lastMovementAt,
      recalculatedAt: new Date(),
    }

    if (existing) {
      await this.db.materialBalance.update({ where: { id: existing.id }, data })
      return
    }
    await this.db.materialBalance.create({
      data: {
        id: generateId(),
        companyId,
        unitId,
        unitStageId,
        stageKey,
        materialId,
        ...data,
      },
    })
  }

  async balancesFor(unitId: string): Promise<readonly BalanceRow[]> {
    const rows = await this.db.materialBalance.findMany({
      where: { unitId },
      orderBy: [{ materialId: 'asc' }],
    })
    if (rows.length === 0) return []

    const materials = await this.db.material.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.materialId))] } },
      select: { id: true, sku: true, nameEn: true, nameAr: true },
    })
    const byId = new Map(materials.map((m) => [m.id, m]))

    return rows.map((row) => {
      const material = byId.get(row.materialId)
      return {
        unitId: row.unitId,
        unitStageId: row.unitStageId,
        materialId: row.materialId,
        sku: material?.sku ?? row.materialId,
        materialNameEn: material?.nameEn ?? '',
        materialNameAr: material?.nameAr ?? '',
        uom: row.uom,
        purchasedQuantity: fixed4(row.purchasedQuantity),
        usedQuantity: fixed4(row.usedQuantity),
        wastedQuantity: fixed4(row.wastedQuantity),
        returnedQuantity: fixed4(row.returnedQuantity),
        remainingQuantity: fixed4(row.remainingQuantity),
        actualCost: fixed4(row.actualCost),
        currency: row.currency,
        lastMovementAt: row.lastMovementAt,
      }
    })
  }
}

/** Prisma Decimal drops trailing zeros; the API contract is fixed 4 dp. */
function fixed4(value: unknown): string {
  return Number(String(value)).toFixed(4)
}

function toMovementRow(row: {
  id: string
  materialId: string
  unitId: string
  unitStageId: string | null
  roomId: string | null
  type: string
  direction: string
  quantity: unknown
  uom: string
  unitCost: unknown
  totalCost: unknown
  currency: string | null
  referenceType: string | null
  referenceId: string | null
  reversalOfMovementId: string | null
  occurredAt: Date
  recordedBy: string
  source: string
  clientEventId: string
  note: string | null
  createdAt: Date
}): MovementRow {
  return {
    id: row.id,
    materialId: row.materialId,
    unitId: row.unitId,
    unitStageId: row.unitStageId,
    roomId: row.roomId,
    type: row.type as StockMovementType,
    direction: row.direction as StockDirection,
    quantity: fixed4(row.quantity),
    uom: row.uom as UnitOfMeasure,
    unitCost: row.unitCost === null ? null : fixed4(row.unitCost),
    totalCost: row.totalCost === null ? null : fixed4(row.totalCost),
    currency: row.currency,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reversalOfMovementId: row.reversalOfMovementId,
    occurredAt: row.occurredAt,
    recordedBy: row.recordedBy,
    source: row.source as MovementRow['source'],
    clientEventId: row.clientEventId,
    note: row.note,
    createdAt: row.createdAt,
  }
}
