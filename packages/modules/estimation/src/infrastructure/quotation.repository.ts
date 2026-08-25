import { Prisma, type Database } from '@buildflow/database'
import type { CompanyId, QuotationId } from '@buildflow/core'
import { Quotation } from '../domain/quotation'

/**
 * Quotation persistence.
 *
 * The document number is a per-company sequence claimed optimistically — the
 * unique key is the arbiter and a collision retries with the next number,
 * rather than locking a counter row. Same contract as PO and receipt numbers.
 */

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class PrismaQuotationRepository {
  constructor(private readonly db: Database) {}

  async findById(id: QuotationId): Promise<Quotation | null> {
    const row = await this.db.quotation.findFirst({ where: { id } })
    if (!row) return null

    return Quotation.restore({
      id: row.id as QuotationId,
      companyId: row.companyId as CompanyId,
      boqId: row.boqId,
      unitId: row.unitId,
      clientId: row.clientId,
      quotationNumber: row.quotationNumber,
      status: row.status,
      validUntil: row.validUntil,
      markupPercentage: fixed(row.markupPercentage, 2),
      discountAmount: fixed(row.discountAmount, 2),
      taxPercentage: fixed(row.taxPercentage, 2),
      basisAmount: fixed(row.basisAmount, 2),
      markupAmount: fixed(row.markupAmount, 2),
      netAmount: fixed(row.netAmount, 2),
      taxAmount: fixed(row.taxAmount, 2),
      totalAmount: fixed(row.totalAmount, 2),
      currency: row.currency,
      language: row.language,
      sentAt: row.sentAt,
      viewedAt: row.viewedAt,
      respondedAt: row.respondedAt,
      documentId: row.documentId,
      notes: row.notes,
      version: row.version,
    })
  }

  /** False when the number was taken — the caller retries with the next one. */
  async create(quotation: Quotation): Promise<boolean> {
    const snapshot = quotation.toSnapshot()
    try {
      await this.db.quotation.create({
        data: {
          id: snapshot.id,
          boqId: snapshot.boqId,
          unitId: snapshot.unitId,
          clientId: snapshot.clientId,
          quotationNumber: snapshot.quotationNumber,
          status: snapshot.status,
          validUntil: snapshot.validUntil,
          markupPercentage: snapshot.markupPercentage,
          discountAmount: snapshot.discountAmount,
          taxPercentage: snapshot.taxPercentage,
          basisAmount: snapshot.basisAmount,
          markupAmount: snapshot.markupAmount,
          netAmount: snapshot.netAmount,
          taxAmount: snapshot.taxAmount,
          totalAmount: snapshot.totalAmount,
          currency: snapshot.currency,
          language: snapshot.language,
          notes: snapshot.notes,
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

  /**
   * Only the tracking fields move after creation — the money is frozen at
   * creation and the domain refuses to change it, so it is not even written
   * here. What cannot be expressed cannot be corrupted.
   */
  async save(quotation: Quotation): Promise<void> {
    const snapshot = quotation.toSnapshot()
    const result = await this.db.quotation.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        status: snapshot.status,
        sentAt: snapshot.sentAt,
        viewedAt: snapshot.viewedAt,
        respondedAt: snapshot.respondedAt,
        documentId: snapshot.documentId,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of Quotation ${snapshot.id}`)
    }
  }

  async nextNumber(): Promise<string> {
    const count = await this.db.quotation.count()
    return `QT-${String(count + 1).padStart(5, '0')}`
  }
}

export interface QuotationListRow {
  id: string
  quotationNumber: string
  boqId: string
  unitId: string
  status: string
  validUntil: Date
  totalAmount: string
  currency: string
  language: string
  sentAt: Date | null
  viewedAt: Date | null
  respondedAt: Date | null
}

export class QuotationQueries {
  constructor(private readonly db: Database) {}

  async list(filter: { unitId?: string; status?: string }): Promise<readonly QuotationListRow[]> {
    const rows = await this.db.quotation.findMany({
      where: {
        ...(filter.unitId ? { unitId: filter.unitId } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    })
    return rows.map((row) => ({
      id: row.id,
      quotationNumber: row.quotationNumber,
      boqId: row.boqId,
      unitId: row.unitId,
      status: row.status,
      validUntil: row.validUntil,
      totalAmount: fixed(row.totalAmount, 2),
      currency: row.currency,
      language: row.language,
      sentAt: row.sentAt,
      viewedAt: row.viewedAt,
      respondedAt: row.respondedAt,
    }))
  }

  /**
   * Open quotations whose shelf life has run out — what a scheduled sweep
   * expires. Returns ids only; the transition belongs to the aggregate.
   */
  async expiredOpen(asOf: Date): Promise<string[]> {
    const rows = await this.db.quotation.findMany({
      where: { status: { in: ['sent', 'viewed'] }, validUntil: { lt: asOf } },
      select: { id: true },
      take: 500,
    })
    return rows.map((row) => row.id)
  }
}
