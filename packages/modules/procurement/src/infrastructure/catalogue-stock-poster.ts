import {
  type CompanyId,
  type DomainError,
  type IdGenerator,
  type MaterialId,
  type Result,
  Quantity,
  err,
  notFoundError,
  ok,
} from '@buildflow/core'
import { getTenantContext, type Database } from '@buildflow/database'
import {
  PrismaBalanceProjection,
  PrismaMaterialRepository,
  PrismaStockLedger,
} from '@buildflow/catalogue'
import type { StockPoster } from '../application/receive-goods.handler'

/**
 * The adapter that turns an accepted receipt line into a ledger entry.
 *
 * Composes the CATALOGUE's public contract — this module never reaches into its
 * internals (docs/03 §6.1). The base-unit conversion happens here, through the
 * material's own factors, for the same reason the /convert endpoint exists: a
 * receipt that books 10 boxes as 10 m² understates stock by 30%, and every
 * consumer of the ledger would inherit the lie.
 */
export class CatalogueStockPoster implements StockPoster {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  async postReceipt(
    entry: Parameters<StockPoster['postReceipt']>[0],
  ): Promise<Result<void, DomainError>> {
    const materials = new PrismaMaterialRepository(this.db)
    const material = await materials.findById(entry.materialId as MaterialId)
    if (!material) return err(notFoundError('Material', entry.materialId))

    const quantity = Quantity.from(entry.quantity, entry.uom)
    if (quantity.isErr()) return err(quantity.error)

    const base = material.toBaseQuantity(quantity.value)
    if (base.isErr()) return err(base.error)

    const ledger = new PrismaStockLedger(this.db)
    // The receipt line id is the idempotency key: a crash-and-retry that
    // reaches an already-posted line is swallowed by the ledger's unique key.
    await ledger.append({
      id: this.ids.next(),
      materialId: material.id,
      unitId: entry.unitId,
      unitStageId: null,
      roomId: null,
      type: 'purchase_receipt',
      direction: 'in',
      quantity: base.value.toDecimal(),
      uom: material.baseUom,
      unitCost: null,
      totalCost: entry.totalCost,
      currency: entry.currency,
      referenceType: 'goods_receipt_line',
      referenceId: entry.receiptLineId,
      reversalOfMovementId: null,
      occurredAt: entry.occurredAt,
      recordedBy: entry.recordedBy,
      source: 'web',
      clientEventId: entry.receiptLineId,
      note: null,
    })

    const companyId = (getTenantContext()?.companyId ?? '') as CompanyId
    await new PrismaBalanceProjection(this.db).recalculate(
      companyId,
      entry.unitId,
      null,
      material.id,
      material.baseUom,
      entry.currency,
      () => this.ids.next(),
    )
    return ok(undefined)
  }
}
