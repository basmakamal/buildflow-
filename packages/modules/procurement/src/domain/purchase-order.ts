import { extendLine, toMoney } from './money-math'
import {
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type Result,
  type UnitOfMeasure,
  type PurchaseOrderId,
  AggregateRoot,
  Money,
  err,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * PurchaseOrder — the commitment to a supplier, and the yardstick receipts are
 * measured against.
 *
 * The order's real job happens at receiving time: `recordReceipt` is the guard
 * that keeps the warehouse honest against the paperwork. Over-receipt beyond a
 * small tolerance is refused, because "the supplier sent extra and we booked
 * it" is indistinguishable, in the ledger, from "someone is inflating stock".
 */

export type PurchaseOrderStatus =
  'draft' | 'issued' | 'partially_received' | 'received' | 'cancelled'

const TRANSITIONS: Readonly<Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>> = {
  draft: ['issued', 'cancelled'],
  issued: ['partially_received', 'received', 'cancelled'],
  partially_received: ['partially_received', 'received'],
  received: [],
  cancelled: [],
}

export interface OrderLine {
  id: string
  materialId: string
  /** Ordered quantity, decimal string 4 dp, in `uom`. */
  quantity: string
  uom: UnitOfMeasure
  unitPrice: string
  lineTotal: string
  receivedQuantity: string
}

export interface PurchaseOrderSnapshot {
  id: PurchaseOrderId
  companyId: CompanyId
  requestId: string | null
  supplierId: string
  poNumber: string
  status: PurchaseOrderStatus
  issuedAt: Date | null
  expectedDeliveryDate: Date | null
  subtotal: string
  taxAmount: string
  total: string
  currency: string
  terms: string | null
  lines: OrderLine[]
  version: number
}

export interface ReceiptLineInput {
  poLineId: string
  /** Accepted quantity, in the PO line's uom. */
  quantity: string
  rejectedQuantity: string
  rejectionReason: string | null
}

export interface AcceptedReceiptLine {
  poLineId: string
  materialId: string
  quantity: string
  uom: UnitOfMeasure
  /** Pro-rated from the PO line price — what this delivery cost. */
  totalCost: string
}

const QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/
const SCALE = 4

function toScaled(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.split('.')
  return BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE))
}

function toDecimal(scaled: bigint): string {
  const digits = scaled.toString().padStart(SCALE + 1, '0')
  return `${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`
}

/**
 * Suppliers routinely deliver a little over — a broken box replaced, a roll
 * that measures long. 2% absorbs that without paperwork; anything more needs a
 * revised order, because the ledger must never book stock nobody agreed to buy.
 */
const OVER_RECEIPT_TOLERANCE_NUMERATOR = 102n
const OVER_RECEIPT_TOLERANCE_DENOMINATOR = 100n

export class PurchaseOrder extends AggregateRoot<PurchaseOrderId> {
  #status: PurchaseOrderStatus
  #issuedAt: Date | null
  #lines: OrderLine[]

  private constructor(
    id: PurchaseOrderId,
    readonly companyId: CompanyId,
    readonly requestId: string | null,
    readonly supplierId: string,
    readonly poNumber: string,
    readonly expectedDeliveryDate: Date | null,
    readonly taxAmount: string,
    readonly currency: string,
    readonly terms: string | null,
    lines: OrderLine[],
    status: PurchaseOrderStatus,
    issuedAt: Date | null,
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#issuedAt = issuedAt
    this.#lines = lines
  }

  static create(
    props: Omit<
      PurchaseOrderSnapshot,
      'status' | 'issuedAt' | 'subtotal' | 'total' | 'version' | 'lines'
    > & {
      lines: Omit<OrderLine, 'lineTotal' | 'receivedQuantity'>[]
    },
  ): Result<PurchaseOrder, DomainError> {
    if (props.lines.length === 0) {
      return err(validationError('ORDER_NEEDS_LINES', 'A purchase order needs at least one line'))
    }

    const lines: OrderLine[] = []
    for (const line of props.lines) {
      if (!QUANTITY_PATTERN.test(line.quantity) || Number(line.quantity) <= 0) {
        return err(
          validationError('ORDER_QUANTITY_INVALID', 'Line quantities must be positive decimals', {
            materialId: line.materialId,
          }),
        )
      }
      if (!QUANTITY_PATTERN.test(line.unitPrice)) {
        return err(
          validationError('ORDER_PRICE_INVALID', 'Unit prices must be positive decimals', {
            materialId: line.materialId,
          }),
        )
      }
      const extended = extendLine(line.quantity, line.unitPrice, props.currency)
      if (extended.isErr()) return err(extended.error)

      lines.push({ ...line, lineTotal: extended.value.toDecimal(), receivedQuantity: '0.0000' })
    }

    return ok(
      new PurchaseOrder(
        props.id,
        props.companyId,
        props.requestId,
        props.supplierId,
        props.poNumber,
        props.expectedDeliveryDate,
        props.taxAmount,
        props.currency,
        props.terms,
        lines,
        'draft',
        null,
        0,
      ),
    )
  }

  static restore(snapshot: PurchaseOrderSnapshot): PurchaseOrder {
    return new PurchaseOrder(
      snapshot.id,
      snapshot.companyId,
      snapshot.requestId,
      snapshot.supplierId,
      snapshot.poNumber,
      snapshot.expectedDeliveryDate,
      snapshot.taxAmount,
      snapshot.currency,
      snapshot.terms,
      snapshot.lines,
      snapshot.status,
      snapshot.issuedAt,
      snapshot.version,
    )
  }

  get status(): PurchaseOrderStatus {
    return this.#status
  }
  get lines(): readonly OrderLine[] {
    return this.#lines
  }

  subtotal(): Result<string, DomainError> {
    let total = Money.zero(this.currency as CurrencyCode)
    for (const line of this.#lines) {
      // Stored as DECIMAL(18,4); toMoney strips the cosmetic trailing zeros.
      const lineTotal = toMoney(line.lineTotal, this.currency)
      if (lineTotal.isErr()) return err(lineTotal.error)
      total = total.add(lineTotal.value)
    }
    return ok(total.toDecimal())
  }

  total(): Result<string, DomainError> {
    const sub = this.subtotal()
    if (sub.isErr()) return sub
    const subMoney = toMoney(sub.value, this.currency)
    if (subMoney.isErr()) return err(subMoney.error)
    const tax = toMoney(this.taxAmount, this.currency)
    if (tax.isErr()) return err(tax.error)
    return ok(subMoney.value.add(tax.value).toDecimal())
  }

  issue(at: Date): Result<void, DomainError> {
    const result = this.transition('issued')
    if (result.isErr()) return result
    this.#issuedAt = at
    return ok(undefined)
  }

  cancel(): Result<void, DomainError> {
    return this.transition('cancelled')
  }

  /**
   * Applies one delivery to the order: validates every line against what
   * remains receivable, advances the running totals, settles the status, and
   * returns the accepted lines with their pro-rated cost — the exact payload
   * the ledger needs, so the caller cannot recompute it differently.
   *
   * Rejected quantities are recorded but never enter the ledger: stock that was
   * refused at the gate never existed, financially.
   */
  recordReceipt(inputs: readonly ReceiptLineInput[]): Result<AcceptedReceiptLine[], DomainError> {
    if (this.#status !== 'issued' && this.#status !== 'partially_received') {
      return err(
        validationError('ORDER_NOT_RECEIVABLE', `A ${this.#status} order cannot receive goods`, {
          status: this.#status,
        }),
      )
    }
    if (inputs.length === 0) {
      return err(validationError('RECEIPT_NEEDS_LINES', 'A receipt needs at least one line'))
    }

    const accepted: AcceptedReceiptLine[] = []
    const updates = new Map<string, bigint>()

    for (const input of inputs) {
      const line = this.#lines.find((candidate) => candidate.id === input.poLineId)
      if (!line) {
        return err(
          validationError('RECEIPT_UNKNOWN_LINE', 'That line is not on this purchase order', {
            poLineId: input.poLineId,
          }),
        )
      }
      if (!QUANTITY_PATTERN.test(input.quantity) || Number(input.quantity) <= 0) {
        return err(
          validationError('RECEIPT_QUANTITY_INVALID', 'Received quantities must be positive', {
            poLineId: input.poLineId,
          }),
        )
      }
      if (input.rejectedQuantity !== '0' && !QUANTITY_PATTERN.test(input.rejectedQuantity)) {
        return err(
          validationError('RECEIPT_QUANTITY_INVALID', 'Rejected quantities must be decimals', {
            poLineId: input.poLineId,
          }),
        )
      }
      if (Number(input.rejectedQuantity) > 0 && !input.rejectionReason?.trim()) {
        return err(
          validationError(
            'REJECTION_NEEDS_REASON',
            'Rejected goods need a reason — the supplier will ask',
            { poLineId: input.poLineId },
          ),
        )
      }
      if (updates.has(line.id)) {
        return err(
          validationError('RECEIPT_DUPLICATE_LINE', 'A receipt lists each order line once', {
            poLineId: input.poLineId,
          }),
        )
      }

      const ordered = toScaled(line.quantity)
      const already = toScaled(line.receivedQuantity)
      const incoming = toScaled(input.quantity)
      const ceiling =
        (ordered * OVER_RECEIPT_TOLERANCE_NUMERATOR) / OVER_RECEIPT_TOLERANCE_DENOMINATOR

      if (already + incoming > ceiling) {
        return err(
          validationError(
            'RECEIPT_EXCEEDS_ORDER',
            `Receiving ${input.quantity} would exceed the ordered ${line.quantity} (+2% tolerance)`,
            { poLineId: input.poLineId, ordered: line.quantity, already: line.receivedQuantity },
          ),
        )
      }

      const cost = extendLine(input.quantity, line.unitPrice, this.currency)
      if (cost.isErr()) return err(cost.error)

      updates.set(line.id, already + incoming)
      accepted.push({
        poLineId: line.id,
        materialId: line.materialId,
        quantity: input.quantity,
        uom: line.uom,
        totalCost: cost.value.toDecimal(),
      })
    }

    // All lines validated — apply atomically. Partial application on a failed
    // later line would leave the aggregate half-received in memory.
    for (const [lineId, received] of updates) {
      const line = this.#lines.find((candidate) => candidate.id === lineId)
      if (line) line.receivedQuantity = toDecimal(received)
    }

    const fullyReceived = this.#lines.every(
      (line) => toScaled(line.receivedQuantity) >= toScaled(line.quantity),
    )
    this.#status = fullyReceived ? 'received' : 'partially_received'

    return ok(accepted)
  }

  private transition(next: PurchaseOrderStatus): Result<void, DomainError> {
    if (!TRANSITIONS[this.#status].includes(next)) {
      return err(
        validationError(
          'INVALID_ORDER_TRANSITION',
          `A ${this.#status} order cannot become ${next}`,
          { from: this.#status, to: next },
        ),
      )
    }
    this.#status = next
    return ok(undefined)
  }

  toSnapshot(): PurchaseOrderSnapshot {
    const subtotal = this.subtotal()
    const total = this.total()
    return {
      id: this.id,
      companyId: this.companyId,
      requestId: this.requestId,
      supplierId: this.supplierId,
      poNumber: this.poNumber,
      status: this.#status,
      issuedAt: this.#issuedAt,
      expectedDeliveryDate: this.expectedDeliveryDate,
      subtotal: subtotal.isOk() ? subtotal.value : '0.0000',
      taxAmount: this.taxAmount,
      total: total.isOk() ? total.value : '0.0000',
      currency: this.currency,
      terms: this.terms,
      lines: this.#lines.map((line) => ({ ...line })),
      version: this.version,
    }
  }
}
