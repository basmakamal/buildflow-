import { Prisma, type Database } from '@buildflow/database'
import {
  type CompanyId,
  type DomainError,
  type Result,
  type TaxInvoiceId,
  conflictError,
  err,
  notFoundError,
  ok,
} from '@buildflow/core'
import {
  GENESIS_PREVIOUS_HASH,
  TaxInvoice,
  type BuyerIdentity,
  type TaxInvoiceKind,
  type TaxInvoiceLineInput,
} from '../domain/tax-invoice'
import { invoiceHash, ublInvoiceXml, type SellerDetails } from '../domain/ubl'

/**
 * Tax invoice persistence and ISSUANCE. docs/01 NFR-C4
 *
 * A draft is just a row — validated by the same aggregate rules as the real
 * thing, but holding no chain position. The regulated document exists from
 * the moment `issue` runs, and everything regulated happens inside its one
 * transaction:
 *
 *   next ICV = max(issued icv) + 1
 *   PIH      = the hash of THAT invoice, or the genesis hash for the first
 *   XML      = built, hashed, stored VERBATIM
 *
 * The counter is claimed optimistically and `@@unique([companyId, icv])` is
 * the arbiter — the same contract quotation and PO numbers use. Two
 * concurrent issues both read the same max; one commits, the other hits the
 * unique key and surfaces a retryable conflict instead of a forked chain.
 *
 * Drafts deliberately take NO chain position: a discarded draft must not
 * leave a hole ZATCA would read as a deleted invoice.
 */

export interface TaxInvoiceDraft {
  id: TaxInvoiceId
  companyId: CompanyId
  unitId: string | null
  quotationId: string | null
  kind: TaxInvoiceKind
  status: 'draft' | 'issued'
  invoiceNumber: string
  uuid: string
  icv: number | null
  previousInvoiceHash: string | null
  invoiceHash: string | null
  buyer: BuyerIdentity
  lines: TaxInvoiceLineInput[]
  totals: { taxExclusiveAmount: string; vatAmount: string; taxInclusiveAmount: string }
  currency: string
  xml: string | null
  qr: string | null
  issuedAt: Date | null
  version: number
}

const fixed = (value: unknown): string => Number(String(value)).toFixed(2)

/**
 * Validates draft content by BUILDING the aggregate with a placeholder chain
 * position, then discarding it. One rulebook for drafts and documents; the
 * placeholder never persists — the row's chain columns stay NULL.
 */
export const validateDraft = (input: {
  id: TaxInvoiceId
  companyId: CompanyId
  kind: TaxInvoiceKind
  invoiceNumber: string
  uuid: string
  seller: { name: string; vatNumber: string }
  buyer: BuyerIdentity
  lines: TaxInvoiceLineInput[]
}): Result<TaxInvoice, DomainError> =>
  TaxInvoice.create({
    ...input,
    icv: 1,
    previousInvoiceHash: GENESIS_PREVIOUS_HASH,
    quotationId: null,
    currency: 'SAR',
  })

export class PrismaTaxInvoiceRepository {
  constructor(private readonly db: Database) {}

  async create(draft: {
    id: TaxInvoiceId
    unitId: string | null
    quotationId: string | null
    kind: TaxInvoiceKind
    invoiceNumber: string
    uuid: string
    buyer: BuyerIdentity
    lines: readonly {
      description: string
      quantity: string
      unitPrice: string
      vatRate: string
      netAmount: string
    }[]
    totals: { taxExclusiveAmount: string; vatAmount: string; taxInclusiveAmount: string }
  }): Promise<boolean> {
    try {
      await this.db.taxInvoice.create({
        data: {
          id: draft.id,
          unitId: draft.unitId,
          quotationId: draft.quotationId,
          kind: draft.kind,
          invoiceNumber: draft.invoiceNumber,
          uuid: draft.uuid,
          buyer: draft.buyer as never,
          lines: draft.lines as never,
          taxExclusiveAmount: draft.totals.taxExclusiveAmount,
          vatAmount: draft.totals.vatAmount,
          taxInclusiveAmount: draft.totals.taxInclusiveAmount,
          currency: 'SAR',
        } as never,
      })
      return true
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false
      }
      throw error
    }
  }

  async findById(id: TaxInvoiceId): Promise<TaxInvoiceDraft | null> {
    const row = await this.db.taxInvoice.findFirst({ where: { id } })
    if (!row) return null
    return {
      id: row.id as TaxInvoiceId,
      companyId: row.companyId as CompanyId,
      unitId: row.unitId,
      quotationId: row.quotationId,
      kind: row.kind,
      status: row.status,
      invoiceNumber: row.invoiceNumber,
      uuid: row.uuid,
      icv: row.icv,
      previousInvoiceHash: row.previousInvoiceHash,
      invoiceHash: row.invoiceHash,
      buyer: row.buyer as unknown as BuyerIdentity,
      lines: row.lines as unknown as TaxInvoiceLineInput[],
      totals: {
        taxExclusiveAmount: fixed(row.taxExclusiveAmount),
        vatAmount: fixed(row.vatAmount),
        taxInclusiveAmount: fixed(row.taxInclusiveAmount),
      },
      currency: row.currency,
      xml: row.xml,
      qr: row.qr,
      issuedAt: row.issuedAt,
      version: row.version,
    }
  }

  async listForUnit(unitId: string): Promise<TaxInvoiceDraft[]> {
    const rows = await this.db.taxInvoice.findMany({
      where: { unitId },
      orderBy: { createdAt: 'desc' },
    })
    const found = await Promise.all(rows.map((row) => this.findById(row.id as TaxInvoiceId)))
    return found.filter((row): row is TaxInvoiceDraft => row !== null)
  }

  /**
   * The regulated moment. Returns the issued document, or a CONFLICT the
   * caller may retry when a concurrent issue claimed the same counter.
   */
  async issue(
    id: TaxInvoiceId,
    seller: SellerDetails,
    buyerAddress: SellerDetails['address'] | null,
    now: Date,
  ): Promise<Result<TaxInvoiceDraft, DomainError>> {
    const draft = await this.findById(id)
    if (!draft) {
      return err(notFoundError('TaxInvoice', id))
    }
    if (draft.status !== 'draft') {
      return err(
        conflictError('TAX_INVOICE_ALREADY_ISSUED', 'This invoice is already issued', {
          status: draft.status,
        }),
      )
    }

    try {
      const issued = await this.db.$transaction(async (tx) => {
        const last = await tx.taxInvoice.findFirst({
          where: { status: 'issued' },
          orderBy: { icv: 'desc' },
          select: { icv: true, invoiceHash: true },
        })
        const icv = (last?.icv ?? 0) + 1
        const previousInvoiceHash = last?.invoiceHash ?? GENESIS_PREVIOUS_HASH

        const aggregate = TaxInvoice.create({
          id: draft.id,
          companyId: draft.companyId,
          kind: draft.kind,
          invoiceNumber: draft.invoiceNumber,
          uuid: draft.uuid,
          icv,
          previousInvoiceHash,
          quotationId: draft.quotationId,
          seller: { name: seller.name, vatNumber: seller.vatNumber },
          buyer: draft.buyer,
          currency: 'SAR',
          lines: draft.lines,
        })
        if (aggregate.isErr()) throw new IssueRefused(aggregate.error)
        const invoice = aggregate.value
        const issueResult = invoice.issue(now)
        if (issueResult.isErr()) throw new IssueRefused(issueResult.error)

        const xml = ublInvoiceXml({
          invoice: invoice.snapshot(),
          seller,
          buyer: { ...draft.buyer, address: buyerAddress },
        })
        if (xml.isErr()) throw new IssueRefused(xml.error)
        const hash = invoiceHash(xml.value)
        const qr = invoice.qrPayload()
        if (qr.isErr()) throw new IssueRefused(qr.error)

        await tx.taxInvoice.update({
          where: { id: draft.id },
          data: {
            status: 'issued',
            icv,
            previousInvoiceHash,
            invoiceHash: hash,
            xml: xml.value,
            qr: qr.value,
            issuedAt: now,
            version: { increment: 1 },
          },
        })
        return true
      })
      if (!issued) {
        return err(conflictError('TAX_INVOICE_ISSUE_RACE', 'Retry the issue', {}))
      }
    } catch (error) {
      if (error instanceof IssueRefused) return err(error.reason)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The counter was claimed between our read and our write. The chain
        // is intact — the caller simply retries and gets the next number.
        return err(
          conflictError('TAX_INVOICE_ISSUE_RACE', 'Another invoice was issued first; retry', {}),
        )
      }
      throw error
    }

    const result = await this.findById(id)
    return result ? ok(result) : err(notFoundError('TaxInvoice', id))
  }
}

/** Carries a domain refusal across the transaction boundary intact. */
class IssueRefused extends Error {
  constructor(readonly reason: DomainError) {
    super(reason.message)
  }
}
