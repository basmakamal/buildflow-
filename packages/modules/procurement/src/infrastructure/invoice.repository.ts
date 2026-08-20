import type { Database } from '@buildflow/database'
import type { CompanyId, InvoiceId, UserId } from '@buildflow/core'
import { Invoice, type CostAllocationEntry, type InvoiceLine } from '../domain/invoice'

/**
 * Invoice persistence.
 *
 * Lines are written once — an invoice with different lines is a different
 * invoice. Allocations are a value-object SET, so saving replaces them
 * wholesale: the exact-sum invariant is over the set, and diffing rows would
 * let two partial writes leave a set that sums to the wrong total.
 */

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class PrismaInvoiceRepository {
  constructor(private readonly db: Database) {}

  async findById(id: InvoiceId): Promise<Invoice | null> {
    const row = await this.db.invoice.findFirst({
      where: { id },
      include: { lines: true, allocations: true },
    })
    if (!row) return null

    return Invoice.restore({
      id: row.id as InvoiceId,
      companyId: row.companyId as CompanyId,
      supplierId: row.supplierId,
      poId: row.poId,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      subtotal: fixed(row.subtotal, 2),
      taxRate: fixed(row.taxRate, 2),
      taxAmount: fixed(row.taxAmount, 2),
      total: fixed(row.total, 2),
      currency: row.currency,
      paymentStatus: row.paymentStatus,
      paidAmount: fixed(row.paidAmount, 2),
      paidAt: row.paidAt,
      paymentMethod: row.paymentMethod,
      voidReason: row.voidReason,
      notes: row.notes,
      lines: row.lines.map((line): InvoiceLine => ({
        id: line.id,
        materialId: line.materialId,
        description: line.description,
        quantity: fixed(line.quantity, 4),
        uom: line.uom,
        unitPrice: fixed(line.unitPrice, 4),
        lineTotal: fixed(line.lineTotal, 2),
      })),
      allocations: row.allocations.map((allocation): CostAllocationEntry => ({
        id: allocation.id,
        unitId: allocation.unitId,
        unitStageId: allocation.unitStageId,
        amount: fixed(allocation.amount, 2),
        percentage: allocation.percentage === null ? null : fixed(allocation.percentage, 2),
        allocatedBy: allocation.allocatedBy as UserId,
        allocatedAt: allocation.allocatedAt,
      })),
      version: row.version,
    })
  }

  async numberExists(supplierId: string, invoiceNumber: string): Promise<boolean> {
    return (await this.db.invoice.count({ where: { supplierId, invoiceNumber } })) > 0
  }

  async create(invoice: Invoice): Promise<void> {
    const snapshot = invoice.toSnapshot()
    await this.db.invoice.create({
      data: {
        id: snapshot.id,
        supplierId: snapshot.supplierId,
        poId: snapshot.poId,
        invoiceNumber: snapshot.invoiceNumber,
        invoiceDate: snapshot.invoiceDate,
        dueDate: snapshot.dueDate,
        subtotal: snapshot.subtotal,
        taxRate: snapshot.taxRate,
        taxAmount: snapshot.taxAmount,
        total: snapshot.total,
        currency: snapshot.currency,
        paymentStatus: snapshot.paymentStatus,
        paidAmount: snapshot.paidAmount,
        notes: snapshot.notes,
      } as never,
    })
    await this.db.invoiceLine.createMany({
      data: snapshot.lines.map((line) => ({
        id: line.id,
        invoiceId: snapshot.id,
        materialId: line.materialId,
        description: line.description,
        quantity: line.quantity,
        uom: line.uom,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })) as never,
    })
  }

  async save(invoice: Invoice): Promise<void> {
    const snapshot = invoice.toSnapshot()
    const result = await this.db.invoice.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        paymentStatus: snapshot.paymentStatus,
        paidAmount: snapshot.paidAmount,
        paidAt: snapshot.paidAt,
        paymentMethod: snapshot.paymentMethod,
        voidReason: snapshot.voidReason,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of Invoice ${snapshot.id}`)
    }

    // Replace-the-set: see the class docblock.
    await this.db.costAllocation.deleteMany({ where: { invoiceId: snapshot.id } })
    if (snapshot.allocations.length > 0) {
      await this.db.costAllocation.createMany({
        data: snapshot.allocations.map((allocation) => ({
          id: allocation.id,
          invoiceId: snapshot.id,
          unitId: allocation.unitId,
          unitStageId: allocation.unitStageId,
          amount: allocation.amount,
          percentage: allocation.percentage,
          allocatedBy: allocation.allocatedBy,
          allocatedAt: allocation.allocatedAt,
        })) as never,
      })
    }
  }
}

export interface InvoiceListRow {
  id: string
  invoiceNumber: string
  supplierId: string
  invoiceDate: Date
  total: string
  currency: string
  paymentStatus: string
  paidAmount: string
  allocated: boolean
}

export class InvoiceQueries {
  constructor(private readonly db: Database) {}

  async list(filter: {
    paymentStatus?: string
    supplierId?: string
  }): Promise<readonly InvoiceListRow[]> {
    const rows = await this.db.invoice.findMany({
      where: {
        ...(filter.paymentStatus ? { paymentStatus: filter.paymentStatus as never } : {}),
        ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
      },
      include: { allocations: { select: { id: true }, take: 1 } },
      orderBy: [{ invoiceDate: 'desc' }],
      take: 200,
    })
    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      supplierId: row.supplierId,
      invoiceDate: row.invoiceDate,
      total: fixed(row.total, 2),
      currency: row.currency,
      paymentStatus: row.paymentStatus,
      paidAmount: fixed(row.paidAmount, 2),
      allocated: row.allocations.length > 0,
    }))
  }

  /** Actual cost attributed to a unit: Σ(allocations) of non-void invoices. */
  async allocatedCostForUnit(unitId: string): Promise<{ amount: string; currency: string }[]> {
    const rows = await this.db.costAllocation.findMany({
      where: { unitId, invoice: { paymentStatus: { not: 'void' } } },
      include: { invoice: { select: { currency: true } } },
    })
    const byCurrency = new Map<string, number>()
    for (const row of rows) {
      const key = row.invoice.currency
      byCurrency.set(key, (byCurrency.get(key) ?? 0) + Math.round(Number(row.amount) * 100))
    }
    return [...byCurrency.entries()].map(([currency, minor]) => ({
      currency,
      amount: (minor / 100).toFixed(2),
    }))
  }
}
