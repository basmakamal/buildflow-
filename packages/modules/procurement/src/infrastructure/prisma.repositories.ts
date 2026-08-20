import { Prisma, type Database } from '@buildflow/database'
import type {
  CompanyId,
  GoodsReceiptId,
  PurchaseOrderId,
  PurchaseRequestId,
  UnitOfMeasure,
  UserId,
} from '@buildflow/core'
import { PurchaseOrder, type OrderLine } from '../domain/purchase-order'
import { PurchaseRequest, type RequestLine } from '../domain/purchase-request'
import type { OrderRepository, ReceiptWriter } from '../application/receive-goods.handler'

/**
 * Prisma persistence for procurement. Tenant scoping is injected below this
 * layer; document numbers are per-company sequences claimed optimistically —
 * the unique key is the arbiter, and a collision retries with the next number
 * rather than locking a counter row.
 */

/** Prisma Decimal → fixed-dp string; the API contract is fixed places. */
const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class PrismaPurchaseRequestRepository {
  constructor(private readonly db: Database) {}

  async findById(id: PurchaseRequestId): Promise<PurchaseRequest | null> {
    const row = await this.db.purchaseRequest.findFirst({ where: { id }, include: { lines: true } })
    if (!row) return null
    return PurchaseRequest.restore({
      id: row.id as PurchaseRequestId,
      companyId: row.companyId as CompanyId,
      projectId: row.projectId,
      unitId: row.unitId,
      unitStageId: row.unitStageId,
      requestNumber: row.requestNumber,
      status: row.status,
      requestedBy: row.requestedBy as UserId,
      requestedAt: row.requestedAt,
      requiredByDate: row.requiredByDate,
      approvedBy: row.approvedBy as UserId | null,
      approvedAt: row.approvedAt,
      rejectionReason: row.rejectionReason,
      totalEstimated: fixed(row.totalEstimated, 4),
      currency: row.currency,
      lines: row.lines.map((line): RequestLine => ({
        id: line.id,
        materialId: line.materialId,
        description: line.description,
        quantity: fixed(line.quantity, 4),
        uom: line.uom,
        estimatedUnitPrice:
          line.estimatedUnitPrice === null ? null : fixed(line.estimatedUnitPrice, 4),
        note: line.note,
      })),
      version: row.version,
    })
  }

  async create(request: PurchaseRequest): Promise<void> {
    const snapshot = request.toSnapshot()
    await this.db.purchaseRequest.create({
      data: {
        id: snapshot.id,
        projectId: snapshot.projectId,
        unitId: snapshot.unitId,
        unitStageId: snapshot.unitStageId,
        requestNumber: snapshot.requestNumber,
        status: snapshot.status,
        requestedBy: snapshot.requestedBy,
        requestedAt: snapshot.requestedAt,
        requiredByDate: snapshot.requiredByDate,
        totalEstimated: snapshot.totalEstimated,
        currency: snapshot.currency,
      } as never,
    })
    await this.db.purchaseRequestLine.createMany({
      data: snapshot.lines.map((line) => ({
        id: line.id,
        requestId: snapshot.id,
        materialId: line.materialId,
        description: line.description,
        quantity: line.quantity,
        uom: line.uom,
        estimatedUnitPrice: line.estimatedUnitPrice,
        note: line.note,
      })) as never,
    })
  }

  /** Status transitions only — lines are immutable once submitted. */
  async save(request: PurchaseRequest): Promise<void> {
    const snapshot = request.toSnapshot()
    const result = await this.db.purchaseRequest.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        status: snapshot.status,
        approvedBy: snapshot.approvedBy,
        approvedAt: snapshot.approvedAt,
        rejectionReason: snapshot.rejectionReason,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of PurchaseRequest ${snapshot.id}`)
    }
  }

  async nextRequestNumber(): Promise<string> {
    const count = await this.db.purchaseRequest.count()
    return `PR-${String(count + 1).padStart(5, '0')}`
  }
}

export class PrismaPurchaseOrderRepository implements OrderRepository {
  constructor(private readonly db: Database) {}

  async findById(id: PurchaseOrderId): Promise<PurchaseOrder | null> {
    const row = await this.db.purchaseOrder.findFirst({ where: { id }, include: { lines: true } })
    if (!row) return null
    return PurchaseOrder.restore({
      id: row.id as PurchaseOrderId,
      companyId: row.companyId as CompanyId,
      requestId: row.requestId,
      supplierId: row.supplierId,
      poNumber: row.poNumber,
      status: row.status,
      issuedAt: row.issuedAt,
      expectedDeliveryDate: row.expectedDeliveryDate,
      subtotal: fixed(row.subtotal, 4),
      taxAmount: fixed(row.taxAmount, 4),
      total: fixed(row.total, 4),
      currency: row.currency,
      terms: row.terms,
      lines: row.lines.map((line): OrderLine => ({
        id: line.id,
        materialId: line.materialId,
        quantity: fixed(line.quantity, 4),
        uom: line.uom,
        unitPrice: fixed(line.unitPrice, 4),
        lineTotal: fixed(line.lineTotal, 4),
        receivedQuantity: fixed(line.receivedQuantity, 4),
      })),
      version: row.version,
    })
  }

  async create(order: PurchaseOrder): Promise<void> {
    const snapshot = order.toSnapshot()
    await this.db.purchaseOrder.create({
      data: {
        id: snapshot.id,
        requestId: snapshot.requestId,
        supplierId: snapshot.supplierId,
        poNumber: snapshot.poNumber,
        status: snapshot.status,
        issuedAt: snapshot.issuedAt,
        expectedDeliveryDate: snapshot.expectedDeliveryDate,
        subtotal: snapshot.subtotal,
        taxAmount: snapshot.taxAmount,
        total: snapshot.total,
        currency: snapshot.currency,
        terms: snapshot.terms,
      } as never,
    })
    await this.db.purchaseOrderLine.createMany({
      data: snapshot.lines.map((line) => ({
        id: line.id,
        poId: snapshot.id,
        materialId: line.materialId,
        quantity: line.quantity,
        uom: line.uom,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        receivedQuantity: line.receivedQuantity,
      })) as never,
    })
  }

  async save(order: PurchaseOrder): Promise<void> {
    const snapshot = order.toSnapshot()
    const result = await this.db.purchaseOrder.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: { status: snapshot.status, issuedAt: snapshot.issuedAt, version: { increment: 1 } },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of PurchaseOrder ${snapshot.id}`)
    }
    // Received quantities are the only mutable line state.
    for (const line of snapshot.lines) {
      await this.db.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQuantity: line.receivedQuantity },
      })
    }
  }

  async nextPoNumber(): Promise<string> {
    const count = await this.db.purchaseOrder.count()
    return `PO-${String(count + 1).padStart(5, '0')}`
  }
}

export class PrismaReceiptWriter implements ReceiptWriter {
  constructor(private readonly db: Database) {}

  async create(receipt: Parameters<ReceiptWriter['create']>[0]): Promise<boolean> {
    try {
      await this.db.goodsReceipt.create({
        data: {
          id: receipt.id,
          poId: receipt.poId,
          supplierId: receipt.supplierId,
          unitId: receipt.unitId,
          receiptNumber: receipt.receiptNumber,
          receivedAt: receipt.receivedAt,
          receivedBy: receipt.receivedBy,
          notes: receipt.notes,
          clientEventId: receipt.clientEventId,
        } as never,
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false
      }
      throw error
    }

    await this.db.goodsReceiptLine.createMany({
      data: receipt.lines.map((line) => ({
        id: line.id,
        receiptId: receipt.id,
        poLineId: line.poLineId,
        materialId: line.materialId,
        quantity: line.quantity,
        uom: line.uom,
        rejectedQuantity: line.rejectedQuantity,
        rejectionReason: line.rejectionReason,
      })) as never,
    })
    return true
  }

  async nextReceiptNumber(): Promise<string> {
    const count = await this.db.goodsReceipt.count()
    return `GR-${String(count + 1).padStart(5, '0')}`
  }

  async findByClientEventId(
    clientEventId: string,
  ): Promise<{ id: GoodsReceiptId; receiptNumber: string } | null> {
    const row = await this.db.goodsReceipt.findFirst({
      where: { clientEventId },
      select: { id: true, receiptNumber: true },
    })
    return row ? { id: row.id as GoodsReceiptId, receiptNumber: row.receiptNumber } : null
  }
}

export interface SupplierRow {
  id: string
  code: string
  nameEn: string
  nameAr: string
  contactPerson: string | null
  mobile: string | null
  email: string | null
  city: string | null
  paymentTermsDays: number
  isActive: boolean
}

export class SupplierQueries {
  constructor(private readonly db: Database) {}

  async list(): Promise<readonly SupplierRow[]> {
    const rows = await this.db.supplier.findMany({
      where: { deletedAt: null },
      orderBy: [{ code: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      contactPerson: row.contactPerson,
      mobile: row.mobile,
      email: row.email,
      city: row.city,
      paymentTermsDays: row.paymentTermsDays,
      isActive: row.isActive,
    }))
  }

  async codeExists(code: string): Promise<boolean> {
    return (await this.db.supplier.count({ where: { code, deletedAt: null } })) > 0
  }

  async exists(id: string): Promise<boolean> {
    return (await this.db.supplier.count({ where: { id, deletedAt: null } })) > 0
  }
}

export interface ReceiptRow {
  id: GoodsReceiptId
  receiptNumber: string
  poId: string
  receivedAt: Date
  receivedBy: string
  lines: {
    materialId: string
    quantity: string
    uom: UnitOfMeasure
    rejectedQuantity: string
  }[]
}

export class ReceiptQueries {
  constructor(private readonly db: Database) {}

  async forOrder(poId: PurchaseOrderId): Promise<readonly ReceiptRow[]> {
    const rows = await this.db.goodsReceipt.findMany({
      where: { poId },
      include: { lines: true },
      orderBy: [{ receivedAt: 'desc' }],
    })
    return rows.map((row) => ({
      id: row.id as GoodsReceiptId,
      receiptNumber: row.receiptNumber,
      poId: row.poId,
      receivedAt: row.receivedAt,
      receivedBy: row.receivedBy,
      lines: row.lines.map((line) => ({
        materialId: line.materialId,
        quantity: fixed(line.quantity, 4),
        uom: line.uom,
        rejectedQuantity: fixed(line.rejectedQuantity, 4),
      })),
    }))
  }
}
