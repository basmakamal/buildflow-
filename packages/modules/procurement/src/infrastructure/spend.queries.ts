import type { Database } from '@buildflow/database'
import { type CurrencyCode, Money, exponentOf } from '@buildflow/core'

/**
 * Spend reports and supplier performance. Phase 3 sprint 8. docs/16 §Phase 3
 *
 * Read models over the procurement trail — no writes, no state. Spend is
 * always Σ over NON-VOID invoices, because void money is not cost, and always
 * grouped per currency with no implicit conversion: a rate nobody chose is how
 * two reports of the same quarter disagree.
 *
 * Supplier performance measures the two promises a supplier actually makes —
 * "it will arrive on time" (receipts against the PO's expected date) and "it
 * will arrive usable" (receipt lines with rejections). Both rates are honest
 * about their denominator: a supplier with nothing measurable reports null,
 * never a flattering 100%.
 */

export interface CurrencyAmount {
  currency: string
  amount: string
}

export interface SupplierSpendRow {
  supplierId: string
  code: string
  nameEn: string
  nameAr: string
  invoiceCount: number
  spend: CurrencyAmount[]
}

export interface UnitSpendRow {
  unitId: string
  unitNumber: string
  name: string
  spend: CurrencyAmount[]
}

export interface MonthSpendRow {
  /** ISO year-month, e.g. "2026-08". Grouped on the INVOICE date. */
  month: string
  invoiceCount: number
  spend: CurrencyAmount[]
}

export interface DateRange {
  from?: Date
  to?: Date
}

export interface SupplierPerformanceRow {
  supplierId: string
  code: string
  nameEn: string
  nameAr: string
  /** POs that made it past draft and were not cancelled. */
  orderCount: number
  /** Issued or partially received — money committed, goods not fully in. */
  openOrderCount: number
  spend: CurrencyAmount[]
  receiptCount: number
  /**
   * Share of receipts that arrived on or before the PO's expected date, as a
   * percentage with 2 dp. Only receipts on POs that HAVE an expected date are
   * measured; null when none are.
   */
  onTimeRate: string | null
  /** Share of receipt lines carrying any rejection, 2 dp. Null with no lines. */
  rejectionRate: string | null
}

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

/** Per-currency exact summation in minor units — never floats across a report. */
class CurrencyTotals {
  #totals = new Map<string, Money>()

  add(amount: unknown, currency: string): void {
    const code = currency as CurrencyCode
    const parsed = Money.fromDecimal(fixed(amount, exponentOf(code)), code)
    if (parsed.isErr()) return
    this.#totals.set(currency, (this.#totals.get(currency) ?? Money.zero(code)).add(parsed.value))
  }

  toRows(): CurrencyAmount[] {
    return [...this.#totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, total]) => ({ currency, amount: total.toDecimal() }))
  }
}

const invoiceDateFilter = (range: DateRange) =>
  range.from || range.to
    ? {
        invoiceDate: {
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lte: range.to } : {}),
        },
      }
    : {}

export class SpendQueries {
  constructor(private readonly db: Database) {}

  /** Σ non-void invoice totals per supplier, largest spender story first. */
  async bySupplier(range: DateRange): Promise<SupplierSpendRow[]> {
    const invoices = await this.db.invoice.findMany({
      where: { paymentStatus: { not: 'void' }, ...invoiceDateFilter(range) },
      select: { supplierId: true, total: true, currency: true },
    })
    if (invoices.length === 0) return []

    const totals = new Map<string, { totals: CurrencyTotals; count: number }>()
    for (const invoice of invoices) {
      const entry = totals.get(invoice.supplierId) ?? { totals: new CurrencyTotals(), count: 0 }
      entry.totals.add(invoice.total, invoice.currency)
      entry.count += 1
      totals.set(invoice.supplierId, entry)
    }

    const suppliers = await this.db.supplier.findMany({
      where: { id: { in: [...totals.keys()] } },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    })

    return suppliers
      .map((supplier): SupplierSpendRow => {
        const entry = totals.get(supplier.id)
        return {
          supplierId: supplier.id,
          code: supplier.code,
          nameEn: supplier.nameEn,
          nameAr: supplier.nameAr,
          invoiceCount: entry?.count ?? 0,
          spend: entry?.totals.toRows() ?? [],
        }
      })
      .sort((a, b) => a.code.localeCompare(b.code))
  }

  /**
   * Σ allocations of non-void invoices per unit. This is attributed spend, so
   * an unallocated invoice appears in the supplier and month views but not
   * here — the gap between the two IS the unallocated backlog.
   */
  async byUnit(range: DateRange): Promise<UnitSpendRow[]> {
    const allocations = await this.db.costAllocation.findMany({
      where: { invoice: { paymentStatus: { not: 'void' }, ...invoiceDateFilter(range) } },
      select: { unitId: true, amount: true, invoice: { select: { currency: true } } },
    })
    if (allocations.length === 0) return []

    const totals = new Map<string, CurrencyTotals>()
    for (const allocation of allocations) {
      const entry = totals.get(allocation.unitId) ?? new CurrencyTotals()
      entry.add(allocation.amount, allocation.invoice.currency)
      totals.set(allocation.unitId, entry)
    }

    const units = await this.db.unit.findMany({
      where: { id: { in: [...totals.keys()] } },
      select: { id: true, unitNumber: true, name: true },
    })

    return units
      .map((unit): UnitSpendRow => ({
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        name: unit.name,
        spend: totals.get(unit.id)?.toRows() ?? [],
      }))
      .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber))
  }

  /** Σ non-void invoice totals per calendar month of the invoice date. */
  async byMonth(range: DateRange): Promise<MonthSpendRow[]> {
    const invoices = await this.db.invoice.findMany({
      where: { paymentStatus: { not: 'void' }, ...invoiceDateFilter(range) },
      select: { invoiceDate: true, total: true, currency: true },
    })

    const totals = new Map<string, { totals: CurrencyTotals; count: number }>()
    for (const invoice of invoices) {
      // UTC on purpose: the invoice date is stored as a UTC instant, and a
      // server-local grouping would move month boundaries with the timezone.
      const month = invoice.invoiceDate.toISOString().slice(0, 7)
      const entry = totals.get(month) ?? { totals: new CurrencyTotals(), count: 0 }
      entry.totals.add(invoice.total, invoice.currency)
      entry.count += 1
      totals.set(month, entry)
    }

    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, entry]) => ({
        month,
        invoiceCount: entry.count,
        spend: entry.totals.toRows(),
      }))
  }
}

export class SupplierPerformanceQueries {
  constructor(private readonly db: Database) {}

  async report(): Promise<SupplierPerformanceRow[]> {
    const suppliers = await this.db.supplier.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    })
    if (suppliers.length === 0) return []

    const orders = await this.db.purchaseOrder.findMany({
      where: { status: { notIn: ['draft', 'cancelled'] } },
      select: { id: true, supplierId: true, status: true, expectedDeliveryDate: true },
    })
    const receipts = await this.db.goodsReceipt.findMany({
      select: {
        supplierId: true,
        receivedAt: true,
        order: { select: { expectedDeliveryDate: true } },
        lines: { select: { rejectedQuantity: true } },
      },
    })
    const invoices = await this.db.invoice.findMany({
      where: { paymentStatus: { not: 'void' } },
      select: { supplierId: true, total: true, currency: true },
    })

    interface Tally {
      orderCount: number
      openOrderCount: number
      spend: CurrencyTotals
      receiptCount: number
      measuredReceipts: number
      onTimeReceipts: number
      lineCount: number
      rejectedLines: number
    }
    const tallies = new Map<string, Tally>()
    const tally = (supplierId: string): Tally => {
      let entry = tallies.get(supplierId)
      if (!entry) {
        entry = {
          orderCount: 0,
          openOrderCount: 0,
          spend: new CurrencyTotals(),
          receiptCount: 0,
          measuredReceipts: 0,
          onTimeReceipts: 0,
          lineCount: 0,
          rejectedLines: 0,
        }
        tallies.set(supplierId, entry)
      }
      return entry
    }

    for (const order of orders) {
      const entry = tally(order.supplierId)
      entry.orderCount += 1
      if (order.status === 'issued' || order.status === 'partially_received') {
        entry.openOrderCount += 1
      }
    }
    for (const receipt of receipts) {
      const entry = tally(receipt.supplierId)
      entry.receiptCount += 1
      if (receipt.order.expectedDeliveryDate) {
        entry.measuredReceipts += 1
        if (receipt.receivedAt <= receipt.order.expectedDeliveryDate) {
          entry.onTimeReceipts += 1
        }
      }
      for (const line of receipt.lines) {
        entry.lineCount += 1
        if (Number(String(line.rejectedQuantity)) > 0) entry.rejectedLines += 1
      }
    }
    for (const invoice of invoices) {
      tally(invoice.supplierId).spend.add(invoice.total, invoice.currency)
    }

    return suppliers.map((supplier): SupplierPerformanceRow => {
      const entry = tallies.get(supplier.id)
      return {
        supplierId: supplier.id,
        code: supplier.code,
        nameEn: supplier.nameEn,
        nameAr: supplier.nameAr,
        orderCount: entry?.orderCount ?? 0,
        openOrderCount: entry?.openOrderCount ?? 0,
        spend: entry?.spend.toRows() ?? [],
        receiptCount: entry?.receiptCount ?? 0,
        onTimeRate: rate(entry?.onTimeReceipts, entry?.measuredReceipts),
        rejectionRate: rate(entry?.rejectedLines, entry?.lineCount),
      }
    })
  }
}

/** part/whole as a 2 dp percentage string; null when nothing was measured. */
function rate(part: number | undefined, whole: number | undefined): string | null {
  if (!whole) return null
  const basisPoints = Math.round(((part ?? 0) * 10_000) / whole)
  const digits = String(basisPoints).padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}
