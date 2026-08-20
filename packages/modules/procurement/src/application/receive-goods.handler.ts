import {
  type DomainError,
  type IdGenerator,
  type GoodsReceiptId,
  type PurchaseOrderId,
  type Result,
  type UnitOfMeasure,
  type UserId,
  err,
  notFoundError,
  ok,
  validationError,
} from '@buildflow/core'
import type { PurchaseOrder, ReceiptLineInput } from '../domain/purchase-order'

/**
 * Receiving goods — where paper meets the ledger.
 *
 * One operation, three effects that must agree: the PO's received quantities
 * advance, a receipt document is written, and each accepted line posts a
 * purchase_receipt movement. The quantities and costs the ledger books are the
 * ONES THE ORDER COMPUTED — `recordReceipt` returns them precisely so this
 * handler cannot derive its own and disagree.
 */

export interface OrderRepository {
  findById(id: PurchaseOrderId): Promise<PurchaseOrder | null>
  save(order: PurchaseOrder): Promise<void>
}

export interface ReceiptWriter {
  /** Returns false when the clientEventId was already used — a retry. */
  create(receipt: {
    id: GoodsReceiptId
    poId: PurchaseOrderId
    supplierId: string
    unitId: string | null
    receiptNumber: string
    receivedAt: Date
    receivedBy: UserId
    notes: string | null
    clientEventId: string
    lines: {
      id: string
      poLineId: string
      materialId: string
      quantity: string
      uom: UnitOfMeasure
      rejectedQuantity: string
      rejectionReason: string | null
    }[]
  }): Promise<boolean>
  nextReceiptNumber(): Promise<string>
  /** The receipt already recorded under this client event id, if any. */
  findByClientEventId(
    clientEventId: string,
  ): Promise<{ id: GoodsReceiptId; receiptNumber: string } | null>
}

/**
 * The ledger, as procurement sees it. A PORT rather than a direct import of the
 * catalogue module: the domain rule ("every accepted line becomes an inbound
 * movement") belongs here, but the ledger's mechanics — base-unit conversion,
 * idempotency, projection recalculation — stay the catalogue's business. The
 * adapter in infrastructure/ composes the two public contracts.
 */
export interface StockPoster {
  postReceipt(entry: {
    materialId: string
    unitId: string
    receiptLineId: string
    quantity: string
    uom: UnitOfMeasure
    totalCost: string
    currency: string
    recordedBy: UserId
    occurredAt: Date
  }): Promise<Result<void, DomainError>>
}

export interface ReceiveGoodsCommand {
  poId: PurchaseOrderId
  /** Movements need a destination; a receipt without a unit is a warehouse we do not have yet. */
  unitId: string
  receivedBy: UserId
  receivedAt: Date
  notes: string | null
  clientEventId: string
  lines: ReceiptLineInput[]
}

export interface ReceiveGoodsResult {
  receiptId: GoodsReceiptId
  receiptNumber: string
  orderStatus: string
  duplicate: boolean
  postedMovements: number
}

export class ReceiveGoodsHandler {
  constructor(
    private readonly orders: OrderRepository,
    private readonly receipts: ReceiptWriter,
    private readonly stock: StockPoster,
    private readonly ids: IdGenerator,
  ) {}

  async handle(command: ReceiveGoodsCommand): Promise<Result<ReceiveGoodsResult, DomainError>> {
    // Idempotency FIRST, before any validation. A retry arrives after the
    // original already advanced the order's received quantities, so replaying
    // the domain checks would refuse it as over-receipt — a duplicate must be
    // recognised as a duplicate, not re-judged against the world it changed.
    const existing = await this.receipts.findByClientEventId(command.clientEventId)
    if (existing) {
      return ok({
        receiptId: existing.id,
        receiptNumber: existing.receiptNumber,
        orderStatus: 'unchanged',
        duplicate: true,
        postedMovements: 0,
      })
    }

    const order = await this.orders.findById(command.poId)
    if (!order) return err(notFoundError('Purchase order', command.poId))

    if (command.lines.length === 0) {
      return err(validationError('RECEIPT_NEEDS_LINES', 'A receipt needs at least one line'))
    }

    // The domain validates and applies atomically in memory; nothing below
    // runs unless every line was legal.
    const accepted = order.recordReceipt(command.lines)
    if (accepted.isErr()) return err(accepted.error)

    const receiptId = this.ids.next<'GoodsReceiptId'>()
    const receiptNumber = await this.receipts.nextReceiptNumber()

    const receiptLines = accepted.value.map((line) => {
      const input = command.lines.find((candidate) => candidate.poLineId === line.poLineId)
      return {
        id: this.ids.next(),
        poLineId: line.poLineId,
        materialId: line.materialId,
        quantity: line.quantity,
        uom: line.uom,
        rejectedQuantity: input?.rejectedQuantity ?? '0',
        rejectionReason: input?.rejectionReason ?? null,
      }
    })

    // The receipt document is the idempotency anchor: written FIRST, before the
    // order mutation or any movement. A retry that lost its response hits the
    // clientEventId key here and stops — with nothing else half-done.
    const created = await this.receipts.create({
      id: receiptId,
      poId: command.poId,
      supplierId: order.supplierId,
      unitId: command.unitId,
      receiptNumber,
      receivedAt: command.receivedAt,
      receivedBy: command.receivedBy,
      notes: command.notes,
      clientEventId: command.clientEventId,
      lines: receiptLines,
    })
    if (!created) {
      return ok({
        receiptId,
        receiptNumber: '',
        orderStatus: order.status,
        duplicate: true,
        postedMovements: 0,
      })
    }

    await this.orders.save(order)

    // Each line's movement uses the RECEIPT LINE id as its client event id, so
    // a crash between two movements resumes idempotently: the ledger's own
    // unique key swallows the ones that already landed.
    let posted = 0
    for (const [index, line] of accepted.value.entries()) {
      const receiptLine = receiptLines[index]
      if (!receiptLine) continue
      const result = await this.stock.postReceipt({
        materialId: line.materialId,
        unitId: command.unitId,
        receiptLineId: receiptLine.id,
        quantity: line.quantity,
        uom: line.uom,
        totalCost: line.totalCost,
        currency: order.currency,
        recordedBy: command.receivedBy,
        occurredAt: command.receivedAt,
      })
      if (result.isErr()) return err(result.error)
      posted++
    }

    return ok({
      receiptId,
      receiptNumber,
      orderStatus: order.status,
      duplicate: false,
      postedMovements: posted,
    })
  }
}
