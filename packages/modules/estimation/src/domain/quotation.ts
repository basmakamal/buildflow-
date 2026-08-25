import {
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type QuotationId,
  type Result,
  AggregateRoot,
  Money,
  err,
  exponentOf,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * Quotation — the client-facing document derived from an approved BOQ.
 * docs/02 §3.7, docs/04 §2.7
 *
 * THE MONEY CHAIN, and the order is the point:
 *
 *   basis    = the BOQ's PRE-TAX total (cost + overhead + profit)
 *   markup   = basis × markup%          — the commercial layer
 *   gross    = basis + markup
 *   discount = an absolute concession, never below zero
 *   net      = gross − discount
 *   tax      = net × tax%               — LAST, and once
 *   total    = net + tax
 *
 * Tax comes last because VAT is charged on what is actually payable. Taxing a
 * figure that a later discount reduces overstates both the tax and the total,
 * and the client's accountant will find it. Each step rounds once, so the
 * printed document survives a hand check.
 *
 * CONTENT FREEZES ON SEND. A quotation the client is holding cannot change
 * under them — a new price is a new quotation. Everything after send is
 * TRACKING: viewed, accepted, rejected, expired.
 */

export type QuotationStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired'
export type QuotationLanguage = 'ar' | 'en'

export interface QuotationTotals {
  basisAmount: string
  markupAmount: string
  netAmount: string
  taxAmount: string
  totalAmount: string
}

export interface QuotationSnapshot extends QuotationTotals {
  id: QuotationId
  companyId: CompanyId
  boqId: string
  unitId: string
  clientId: string | null
  quotationNumber: string
  status: QuotationStatus
  validUntil: Date
  markupPercentage: string
  discountAmount: string
  taxPercentage: string
  currency: string
  language: QuotationLanguage
  sentAt: Date | null
  viewedAt: Date | null
  respondedAt: Date | null
  documentId: string | null
  notes: string | null
  version: number
}

const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/
const AMOUNT_PATTERN = /^\d{1,14}(\.\d{1,4})?$/

export class Quotation extends AggregateRoot<QuotationId> {
  #status: QuotationStatus
  #sentAt: Date | null
  #viewedAt: Date | null
  #respondedAt: Date | null
  #documentId: string | null

  private constructor(
    id: QuotationId,
    readonly companyId: CompanyId,
    readonly boqId: string,
    readonly unitId: string,
    readonly clientId: string | null,
    readonly quotationNumber: string,
    readonly validUntil: Date,
    readonly markupPercentage: string,
    readonly discountAmount: string,
    readonly taxPercentage: string,
    readonly currency: string,
    readonly language: QuotationLanguage,
    readonly notes: string | null,
    readonly totals: QuotationTotals,
    status: QuotationStatus,
    sentAt: Date | null,
    viewedAt: Date | null,
    respondedAt: Date | null,
    documentId: string | null,
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#sentAt = sentAt
    this.#viewedAt = viewedAt
    this.#respondedAt = respondedAt
    this.#documentId = documentId
  }

  /**
   * Derives the offer from the BOQ's pre-tax total. Every figure is computed
   * here and stored: the sent document must explain itself years later, even
   * once the BOQ behind it is superseded.
   */
  static create(props: {
    id: QuotationId
    companyId: CompanyId
    boqId: string
    unitId: string
    clientId: string | null
    quotationNumber: string
    /** The BOQ's preTaxTotal — cost plus overhead plus profit, before tax. */
    basis: string
    currency: string
    validUntil: Date
    markupPercentage: string
    discountAmount: string
    taxPercentage: string
    language: QuotationLanguage
    notes: string | null
  }): Result<Quotation, DomainError> {
    if (!Number.isInteger(exponentOf(props.currency as CurrencyCode))) {
      return err(
        validationError('INVALID_CURRENCY', `Unknown currency ${props.currency}`, {
          currency: props.currency,
        }),
      )
    }
    for (const [field, value] of [
      ['markupPercentage', props.markupPercentage],
      ['taxPercentage', props.taxPercentage],
    ] as const) {
      if (!PERCENT_PATTERN.test(value) || Number(value) > 100) {
        return err(
          validationError('QUOTATION_PERCENTAGE_INVALID', 'Percentages are 0–100, at most 2 dp', {
            field,
            value,
          }),
        )
      }
    }
    if (!AMOUNT_PATTERN.test(props.discountAmount)) {
      return err(
        validationError('QUOTATION_DISCOUNT_INVALID', 'A discount is a non-negative amount', {
          discountAmount: props.discountAmount,
        }),
      )
    }

    const basis = Money.fromDecimal(props.basis, props.currency as CurrencyCode)
    if (basis.isErr()) return err(basis.error)
    if (!basis.value.isPositive()) {
      return err(
        validationError(
          'QUOTATION_BASIS_EMPTY',
          'This BOQ prices nothing, so there is no offer to make',
          {},
        ),
      )
    }

    const markup = basis.value.percentage(props.markupPercentage)
    if (markup.isErr()) return err(markup.error)
    const gross = basis.value.add(markup.value)

    const discount = Money.fromDecimal(props.discountAmount, props.currency as CurrencyCode)
    if (discount.isErr()) return err(discount.error)
    // A discount larger than the offer is a data-entry error to refuse now,
    // not a negative invoice to explain later.
    if (discount.value.greaterThan(gross)) {
      return err(
        validationError(
          'QUOTATION_DISCOUNT_EXCEEDS_TOTAL',
          `A discount of ${props.discountAmount} exceeds the ${gross.toDecimal()} offer`,
          { discount: props.discountAmount, gross: gross.toDecimal() },
        ),
      )
    }
    const net = gross.subtract(discount.value)

    const tax = net.percentage(props.taxPercentage)
    if (tax.isErr()) return err(tax.error)

    return ok(
      new Quotation(
        props.id,
        props.companyId,
        props.boqId,
        props.unitId,
        props.clientId,
        props.quotationNumber,
        props.validUntil,
        props.markupPercentage,
        discount.value.toDecimal(),
        props.taxPercentage,
        props.currency,
        props.language,
        props.notes,
        {
          basisAmount: basis.value.toDecimal(),
          markupAmount: markup.value.toDecimal(),
          netAmount: net.toDecimal(),
          taxAmount: tax.value.toDecimal(),
          totalAmount: net.add(tax.value).toDecimal(),
        },
        'draft',
        null,
        null,
        null,
        null,
        0,
      ),
    )
  }

  static restore(snapshot: QuotationSnapshot): Quotation {
    return new Quotation(
      snapshot.id,
      snapshot.companyId,
      snapshot.boqId,
      snapshot.unitId,
      snapshot.clientId,
      snapshot.quotationNumber,
      snapshot.validUntil,
      snapshot.markupPercentage,
      snapshot.discountAmount,
      snapshot.taxPercentage,
      snapshot.currency,
      snapshot.language,
      snapshot.notes,
      {
        basisAmount: snapshot.basisAmount,
        markupAmount: snapshot.markupAmount,
        netAmount: snapshot.netAmount,
        taxAmount: snapshot.taxAmount,
        totalAmount: snapshot.totalAmount,
      },
      snapshot.status,
      snapshot.sentAt,
      snapshot.viewedAt,
      snapshot.respondedAt,
      snapshot.documentId,
      snapshot.version,
    )
  }

  get status(): QuotationStatus {
    return this.#status
  }
  get sentAt(): Date | null {
    return this.#sentAt
  }
  get viewedAt(): Date | null {
    return this.#viewedAt
  }

  /** Whether the offer's shelf life has run out at `at`. Date-inclusive. */
  isExpiredAt(at: Date): boolean {
    return at > endOfDay(this.validUntil)
  }

  /**
   * Hands the offer to the client. An offer already stale on the day it is
   * sent is not an offer, so the shelf life is checked here rather than
   * discovered by the client.
   */
  send(at: Date, documentId: string | null): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError('QUOTATION_NOT_DRAFT', 'Only a draft is sent', { status: this.#status }),
      )
    }
    if (this.isExpiredAt(at)) {
      return err(
        validationError(
          'QUOTATION_ALREADY_EXPIRED',
          'This quotation expires before it would be sent',
          { validUntil: this.validUntil.toISOString() },
        ),
      )
    }
    this.#status = 'sent'
    this.#sentAt = at
    this.#documentId = documentId
    return ok(undefined)
  }

  /**
   * The client opened it. Only the FIRST view stamps the time — "when did they
   * look at it" has one answer, and later opens do not change it.
   */
  markViewed(at: Date): Result<void, DomainError> {
    if (this.#status !== 'sent' && this.#status !== 'viewed') {
      return err(
        validationError('QUOTATION_NOT_SENT', 'Only a sent quotation can be viewed', {
          status: this.#status,
        }),
      )
    }
    if (this.#viewedAt === null) {
      this.#viewedAt = at
      this.#status = 'viewed'
    }
    return ok(undefined)
  }

  accept(at: Date): Result<void, DomainError> {
    return this.respond('accepted', at)
  }

  reject(at: Date): Result<void, DomainError> {
    return this.respond('rejected', at)
  }

  private respond(outcome: 'accepted' | 'rejected', at: Date): Result<void, DomainError> {
    if (this.#status !== 'sent' && this.#status !== 'viewed') {
      return err(
        validationError('QUOTATION_NOT_OPEN', 'Only a sent or viewed quotation can be answered', {
          status: this.#status,
        }),
      )
    }
    // An expired price cannot be accepted into a contract, and rejecting one
    // is equally meaningless — the offer is already gone.
    if (this.isExpiredAt(at)) {
      return err(
        validationError('QUOTATION_EXPIRED', 'This quotation has expired', {
          validUntil: this.validUntil.toISOString(),
        }),
      )
    }
    this.#status = outcome
    this.#respondedAt = at
    return ok(undefined)
  }

  /**
   * Retires an offer nobody answered. Only an OPEN one expires: an accepted
   * quotation stays accepted forever, because it became a commitment.
   */
  expire(at: Date): Result<void, DomainError> {
    if (this.#status !== 'sent' && this.#status !== 'viewed') {
      return err(
        validationError('QUOTATION_NOT_OPEN', 'Only an open quotation expires', {
          status: this.#status,
        }),
      )
    }
    if (!this.isExpiredAt(at)) {
      return err(
        validationError('QUOTATION_STILL_VALID', 'This quotation has not expired yet', {
          validUntil: this.validUntil.toISOString(),
        }),
      )
    }
    this.#status = 'expired'
    return ok(undefined)
  }

  toSnapshot(): QuotationSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      boqId: this.boqId,
      unitId: this.unitId,
      clientId: this.clientId,
      quotationNumber: this.quotationNumber,
      status: this.#status,
      validUntil: this.validUntil,
      markupPercentage: this.markupPercentage,
      discountAmount: this.discountAmount,
      taxPercentage: this.taxPercentage,
      currency: this.currency,
      language: this.language,
      sentAt: this.#sentAt,
      viewedAt: this.#viewedAt,
      respondedAt: this.#respondedAt,
      documentId: this.#documentId,
      notes: this.notes,
      ...this.totals,
      version: this.version,
    }
  }
}

/**
 * validUntil is a DATE, so validity runs to the end of that day. A quotation
 * valid until the 30th is still valid at 17:00 on the 30th — which is what
 * every client assumes, and the only reading that does not quietly lose them
 * a day.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date)
  end.setUTCHours(23, 59, 59, 999)
  return end
}
