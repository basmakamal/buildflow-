import {
  type CompanyId,
  type DomainError,
  type Result,
  type TaxInvoiceId,
  AggregateRoot,
  Money,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import { phase1Qr } from './qr'

/**
 * The tax invoice — the document ZATCA regulates. docs/01 NFR-C4
 *
 * NOT the `Invoice` the procurement module holds: that one is a SUPPLIER's
 * invoice arriving as a cost. This is the invoice the tenant ISSUES, and in
 * Saudi Arabia issuing one is a regulated act with a prescribed shape:
 *
 *   - STANDARD (B2B): carries the buyer's VAT registration, and from ZATCA
 *     phase 2 must be CLEARED — sent to ZATCA and cryptographically stamped
 *     by them BEFORE the client may receive it.
 *   - SIMPLIFIED (B2C): no buyer registration, stamped by the SELLER's own
 *     device, reported to ZATCA within 24 hours of issue.
 *
 * The clearance/reporting flows are a later slice; what this aggregate owns
 * is everything about the document that must be right BEFORE any of that can
 * work: the identity rules, the money chain, the counter and hash chain, and
 * the QR payload.
 *
 * THE CHAIN FIELDS. Every invoice carries an ICV (a per-device counter that
 * only counts up) and the HASH OF THE PREVIOUS INVOICE, making the sequence
 * tamper-evident: deleting or editing an issued invoice breaks every hash
 * after it. This aggregate CARRIES both and validates their shape; issuing
 * them in order is the persistence layer's job, and computing this invoice's
 * OWN hash belongs to the XML slice, because the hash is defined over the
 * canonical XML, not over any in-memory shape.
 *
 * VAT IS COMPUTED PER RATE CATEGORY, NOT PER LINE. EN 16931 (which the ZATCA
 * XML profile is built on) defines category VAT as rate × the SUM of that
 * category's nets. Summing per-line VAT instead drifts by a halala once
 * enough lines round the same way, and a drifted total is a schema-valid
 * invoice that fails clearance arithmetic checks.
 */

export type TaxInvoiceKind = 'standard' | 'simplified'
export type TaxInvoiceStatus = 'draft' | 'issued'

/**
 * A KSA VAT registration: fifteen digits, first and last both `3`.
 * The middle thirteen are the entity's; the bracketing 3s are the country's.
 * Exported so the settings endpoint validates with THE SAME RULE the
 * aggregate enforces — two copies of a format rule always drift.
 */
export const isKsaVatNumber = (value: string): boolean => /^3\d{13}3$/.test(value)
const VAT_NUMBER = { test: isKsaVatNumber }

const QUANTITY_PATTERN = /^\d{1,10}(\.\d{1,4})?$/
const AMOUNT_PATTERN = /^\d{1,14}(\.\d{1,4})?$/
const RATE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/

export interface SellerIdentity {
  /** The registered legal name — what the QR and the XML carry, not a brand. */
  name: string
  vatNumber: string
}

export interface BuyerIdentity {
  name: string
  /** Required on a standard invoice; a simplified one has no buyer identity. */
  vatNumber: string | null
}

export interface TaxInvoiceLineInput {
  description: string
  quantity: string
  unitPrice: string
  /** Percent, 0–100. The standard rate is 15; zero-rated lines carry 0. */
  vatRate: string
}

export interface TaxInvoiceLine extends TaxInvoiceLineInput {
  /** quantity × unitPrice, rounded once. */
  netAmount: string
}

export interface TaxInvoiceTotals {
  taxExclusiveAmount: string
  vatAmount: string
  taxInclusiveAmount: string
}

/**
 * The hash the FIRST invoice in a chain points at, since nothing precedes it:
 * the base64 of the ASCII hex digest of SHA-256("0"), per the ZATCA XML
 * implementation standard. A test recomputes it from primitives.
 */
export const GENESIS_PREVIOUS_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

export interface TaxInvoiceSnapshot {
  id: TaxInvoiceId
  companyId: CompanyId
  kind: TaxInvoiceKind
  status: TaxInvoiceStatus
  invoiceNumber: string
  /** The document's own UUID as ZATCA sees it — distinct from our row id. */
  uuid: string
  icv: number
  previousInvoiceHash: string
  quotationId: string | null
  seller: SellerIdentity
  buyer: BuyerIdentity
  currency: string
  lines: TaxInvoiceLine[]
  totals: TaxInvoiceTotals
  issuedAt: Date | null
  version: number
}

export class TaxInvoice extends AggregateRoot<TaxInvoiceId> {
  #status: TaxInvoiceStatus
  #issuedAt: Date | null

  private constructor(
    id: TaxInvoiceId,
    readonly companyId: CompanyId,
    readonly kind: TaxInvoiceKind,
    readonly invoiceNumber: string,
    readonly uuid: string,
    readonly icv: number,
    readonly previousInvoiceHash: string,
    readonly quotationId: string | null,
    readonly seller: SellerIdentity,
    readonly buyer: BuyerIdentity,
    readonly currency: string,
    readonly lines: readonly TaxInvoiceLine[],
    readonly totals: TaxInvoiceTotals,
    status: TaxInvoiceStatus,
    issuedAt: Date | null,
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#issuedAt = issuedAt
  }

  static create(props: {
    id: TaxInvoiceId
    companyId: CompanyId
    kind: TaxInvoiceKind
    invoiceNumber: string
    uuid: string
    icv: number
    previousInvoiceHash: string
    quotationId: string | null
    seller: SellerIdentity
    buyer: BuyerIdentity
    currency: string
    lines: TaxInvoiceLineInput[]
  }): Result<TaxInvoice, DomainError> {
    // ZATCA's arithmetic, thresholds and stamping are all specified in SAR.
    // Multi-currency display is a document concern; the tax document is riyal.
    if (props.currency !== 'SAR') {
      return err(
        validationError('TAX_INVOICE_CURRENCY', 'A KSA tax invoice is denominated in SAR', {
          currency: props.currency,
        }),
      )
    }
    if (!VAT_NUMBER.test(props.seller.vatNumber)) {
      return err(
        validationError(
          'SELLER_VAT_INVALID',
          'A KSA VAT registration is 15 digits starting and ending with 3',
          { vatNumber: props.seller.vatNumber },
        ),
      )
    }
    if (props.seller.name.trim().length === 0) {
      return err(validationError('SELLER_NAME_MISSING', 'The registered legal name is empty', {}))
    }
    if (props.kind === 'standard') {
      // A standard invoice IS the buyer's input-VAT evidence; without their
      // registration it cannot serve the one purpose it exists for.
      if (!props.buyer.vatNumber || !VAT_NUMBER.test(props.buyer.vatNumber)) {
        return err(
          validationError(
            'BUYER_VAT_REQUIRED',
            'A standard tax invoice needs the buyer VAT registration',
            { vatNumber: props.buyer.vatNumber ?? '(missing)' },
          ),
        )
      }
    }
    if (!Number.isInteger(props.icv) || props.icv < 1) {
      return err(
        validationError('ICV_INVALID', 'The invoice counter is a positive integer', {
          icv: props.icv,
        }),
      )
    }
    if (props.previousInvoiceHash.trim().length === 0) {
      return err(
        validationError(
          'PREVIOUS_HASH_MISSING',
          'Every invoice extends the hash chain; the first uses the genesis hash',
          {},
        ),
      )
    }
    if (props.lines.length === 0) {
      return err(validationError('TAX_INVOICE_EMPTY', 'An invoice prices something', {}))
    }

    const lines: TaxInvoiceLine[] = []
    for (const line of props.lines) {
      if (!QUANTITY_PATTERN.test(line.quantity) || Number(line.quantity) === 0) {
        return err(
          validationError('LINE_QUANTITY_INVALID', 'A quantity is a positive decimal', {
            quantity: line.quantity,
          }),
        )
      }
      if (!AMOUNT_PATTERN.test(line.unitPrice)) {
        return err(
          validationError('LINE_PRICE_INVALID', 'A unit price is a non-negative amount', {
            unitPrice: line.unitPrice,
          }),
        )
      }
      if (!RATE_PATTERN.test(line.vatRate) || Number(line.vatRate) > 100) {
        return err(
          validationError('LINE_VAT_RATE_INVALID', 'A VAT rate is 0–100, at most 2 dp', {
            vatRate: line.vatRate,
          }),
        )
      }
      const price = Money.fromDecimal(line.unitPrice, 'SAR')
      if (price.isErr()) return err(price.error)
      const net = price.value.multiply(line.quantity)
      if (net.isErr()) return err(net.error)
      lines.push({ ...line, netAmount: net.value.toDecimal() })
    }

    // Category VAT: group nets by rate, tax the category sum once.
    const categories = new Map<string, Money>()
    for (const line of lines) {
      const net = Money.fromDecimal(line.netAmount, 'SAR')
      if (net.isErr()) return err(net.error)
      const sum = categories.get(line.vatRate) ?? Money.zero('SAR')
      categories.set(line.vatRate, sum.add(net.value))
    }
    let taxExclusive = Money.zero('SAR')
    let vat = Money.zero('SAR')
    for (const [rate, categoryNet] of categories) {
      taxExclusive = taxExclusive.add(categoryNet)
      const categoryVat = categoryNet.percentage(rate)
      if (categoryVat.isErr()) return err(categoryVat.error)
      vat = vat.add(categoryVat.value)
    }

    return ok(
      new TaxInvoice(
        props.id,
        props.companyId,
        props.kind,
        props.invoiceNumber,
        props.uuid,
        props.icv,
        props.previousInvoiceHash,
        props.quotationId,
        { name: props.seller.name.trim(), vatNumber: props.seller.vatNumber },
        { name: props.buyer.name.trim(), vatNumber: props.buyer.vatNumber },
        props.currency,
        lines,
        {
          taxExclusiveAmount: taxExclusive.toDecimal(),
          vatAmount: vat.toDecimal(),
          taxInclusiveAmount: taxExclusive.add(vat).toDecimal(),
        },
        'draft',
        null,
        0,
      ),
    )
  }

  get status(): TaxInvoiceStatus {
    return this.#status
  }

  get issuedAt(): Date | null {
    return this.#issuedAt
  }

  /**
   * Issuing freezes the document. Everything after this moment is regulated:
   * a wrong issued invoice is corrected by a credit note, never by an edit —
   * the hash chain exists precisely so an edit cannot be quiet.
   */
  issue(now: Date): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError('TAX_INVOICE_ALREADY_ISSUED', 'This invoice is already issued', {
          status: this.#status,
        }),
      )
    }
    this.#status = 'issued'
    this.#issuedAt = now
    return ok(undefined)
  }

  /** The phase 1 QR payload — issuable only for an issued document. */
  qrPayload(): Result<string, DomainError> {
    if (this.#status !== 'issued' || !this.#issuedAt) {
      return err(
        validationError('TAX_INVOICE_NOT_ISSUED', 'The QR belongs to an issued invoice', {
          status: this.#status,
        }),
      )
    }
    return phase1Qr({
      sellerName: this.seller.name,
      sellerVatNumber: this.seller.vatNumber,
      issuedAt: this.#issuedAt,
      invoiceTotal: this.totals.taxInclusiveAmount,
      vatTotal: this.totals.vatAmount,
    })
  }

  snapshot(): TaxInvoiceSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      kind: this.kind,
      status: this.#status,
      invoiceNumber: this.invoiceNumber,
      uuid: this.uuid,
      icv: this.icv,
      previousInvoiceHash: this.previousInvoiceHash,
      quotationId: this.quotationId,
      seller: this.seller,
      buyer: this.buyer,
      currency: this.currency,
      lines: [...this.lines],
      totals: this.totals,
      issuedAt: this.#issuedAt,
      version: this.version,
    }
  }
}
