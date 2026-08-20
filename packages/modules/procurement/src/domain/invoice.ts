import {
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type InvoiceId,
  type Result,
  type UnitOfMeasure,
  type UserId,
  AggregateRoot,
  Money,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import { extendLine, toMoney } from './money-math'

/**
 * Invoice — where actual cost becomes real, and the allocation set — where it
 * becomes attributable.
 *
 * Two invariants carry everything:
 *   1. Σ(allocations) = total, EXACTLY, to the minor unit. A profitability
 *      report built on allocations that drift by a halala per invoice is a
 *      report nobody reconciles twice.
 *   2. A paid invoice is never deleted. It is VOIDED, with a reason, so the
 *      money trail explains itself the way the stock ledger does.
 */

export type InvoicePaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'void'

export interface InvoiceLine {
  id: string
  materialId: string | null
  description: string
  quantity: string
  uom: UnitOfMeasure
  unitPrice: string
  lineTotal: string
}

export interface CostAllocationEntry {
  id: string
  unitId: string
  unitStageId: string | null
  /** Exact amount — the truth. */
  amount: string
  /** What the caller asked for, kept for display only. */
  percentage: string | null
  allocatedBy: UserId
  allocatedAt: Date
}

export interface InvoiceSnapshot {
  id: InvoiceId
  companyId: CompanyId
  supplierId: string
  poId: string | null
  invoiceNumber: string
  invoiceDate: Date
  dueDate: Date | null
  subtotal: string
  taxRate: string
  taxAmount: string
  total: string
  currency: string
  paymentStatus: InvoicePaymentStatus
  paidAmount: string
  paidAt: Date | null
  paymentMethod: string | null
  voidReason: string | null
  notes: string | null
  lines: InvoiceLine[]
  allocations: CostAllocationEntry[]
  version: number
}

const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,4})?$/
const RATE_PATTERN = /^\d{1,3}(\.\d{1,4})?$/
const MAX_LINES = 200

export class Invoice extends AggregateRoot<InvoiceId> {
  #paymentStatus: InvoicePaymentStatus
  #paidAmount: string
  #paidAt: Date | null
  #paymentMethod: string | null
  #voidReason: string | null
  #allocations: CostAllocationEntry[]

  private constructor(
    id: InvoiceId,
    readonly companyId: CompanyId,
    readonly supplierId: string,
    readonly poId: string | null,
    readonly invoiceNumber: string,
    readonly invoiceDate: Date,
    readonly dueDate: Date | null,
    readonly subtotal: string,
    readonly taxRate: string,
    readonly taxAmount: string,
    readonly total: string,
    readonly currency: string,
    readonly notes: string | null,
    readonly lines: readonly InvoiceLine[],
    paymentStatus: InvoicePaymentStatus,
    paidAmount: string,
    paidAt: Date | null,
    paymentMethod: string | null,
    voidReason: string | null,
    allocations: CostAllocationEntry[],
    version: number,
  ) {
    super(id, version)
    this.#paymentStatus = paymentStatus
    this.#paidAmount = paidAmount
    this.#paidAt = paidAt
    this.#paymentMethod = paymentMethod
    this.#voidReason = voidReason
    this.#allocations = allocations
  }

  /**
   * Totals are DERIVED here, never accepted from the caller: an invoice whose
   * printed total disagrees with its own lines is the discrepancy every audit
   * finds first. Tax is computed from the rate and stored, so a later rate
   * change cannot silently restate history.
   */
  static create(
    props: Omit<
      InvoiceSnapshot,
      | 'subtotal'
      | 'taxAmount'
      | 'total'
      | 'paymentStatus'
      | 'paidAmount'
      | 'paidAt'
      | 'paymentMethod'
      | 'voidReason'
      | 'allocations'
      | 'version'
      | 'lines'
    > & {
      lines: Omit<InvoiceLine, 'lineTotal'>[]
    },
  ): Result<Invoice, DomainError> {
    if (props.lines.length === 0) {
      return err(validationError('INVOICE_NEEDS_LINES', 'An invoice needs at least one line'))
    }
    if (props.lines.length > MAX_LINES) {
      return err(validationError('INVOICE_TOO_MANY_LINES', `At most ${MAX_LINES} lines`))
    }
    if (!RATE_PATTERN.test(props.taxRate) || Number(props.taxRate) > 100) {
      return err(
        validationError('INVOICE_TAX_RATE_INVALID', 'The tax rate is a percentage, 0–100', {
          taxRate: props.taxRate,
        }),
      )
    }

    let subtotal = Money.zero(props.currency as CurrencyCode)
    const lines: InvoiceLine[] = []
    for (const line of props.lines) {
      if (!DECIMAL_PATTERN.test(line.quantity) || Number(line.quantity) <= 0) {
        return err(
          validationError('INVOICE_QUANTITY_INVALID', 'Line quantities must be positive decimals', {
            description: line.description,
          }),
        )
      }
      if (!DECIMAL_PATTERN.test(line.unitPrice)) {
        return err(
          validationError('INVOICE_PRICE_INVALID', 'Unit prices must be positive decimals', {
            description: line.description,
          }),
        )
      }
      const extended = extendLine(line.quantity, line.unitPrice, props.currency)
      if (extended.isErr()) return err(extended.error)
      subtotal = subtotal.add(extended.value)
      lines.push({ ...line, lineTotal: extended.value.toDecimal() })
    }

    const tax = subtotal.percentage(props.taxRate)
    if (tax.isErr()) return err(tax.error)
    const total = subtotal.add(tax.value)

    return ok(
      new Invoice(
        props.id,
        props.companyId,
        props.supplierId,
        props.poId,
        props.invoiceNumber,
        props.invoiceDate,
        props.dueDate,
        subtotal.toDecimal(),
        props.taxRate,
        tax.value.toDecimal(),
        total.toDecimal(),
        props.currency,
        props.notes,
        lines,
        'unpaid',
        // Money-formatted from birth: '0' and '0.00' are the same value but
        // different API contracts, and clients compare strings.
        Money.zero(props.currency as CurrencyCode).toDecimal(),
        null,
        null,
        null,
        [],
        0,
      ),
    )
  }

  static restore(snapshot: InvoiceSnapshot): Invoice {
    return new Invoice(
      snapshot.id,
      snapshot.companyId,
      snapshot.supplierId,
      snapshot.poId,
      snapshot.invoiceNumber,
      snapshot.invoiceDate,
      snapshot.dueDate,
      snapshot.subtotal,
      snapshot.taxRate,
      snapshot.taxAmount,
      snapshot.total,
      snapshot.currency,
      snapshot.notes,
      snapshot.lines,
      snapshot.paymentStatus,
      snapshot.paidAmount,
      snapshot.paidAt,
      snapshot.paymentMethod,
      snapshot.voidReason,
      snapshot.allocations,
      snapshot.version,
    )
  }

  get paymentStatus(): InvoicePaymentStatus {
    return this.#paymentStatus
  }
  get paidAmount(): string {
    return this.#paidAmount
  }
  get voidReason(): string | null {
    return this.#voidReason
  }
  get allocations(): readonly CostAllocationEntry[] {
    return this.#allocations
  }

  /**
   * Cumulative and capped at the total: an overpayment is a data-entry error to
   * refuse now, not a credit balance to untangle at year end.
   */
  recordPayment(amount: string, method: string, at: Date): Result<void, DomainError> {
    if (this.#paymentStatus === 'void') {
      return err(validationError('INVOICE_IS_VOID', 'A void invoice cannot take payments'))
    }
    if (this.#paymentStatus === 'paid') {
      return err(validationError('INVOICE_ALREADY_PAID', 'This invoice is already settled'))
    }
    if (!DECIMAL_PATTERN.test(amount) || Number(amount) <= 0) {
      return err(validationError('PAYMENT_AMOUNT_INVALID', 'A payment must be a positive amount'))
    }

    const paid = toMoney(this.#paidAmount, this.currency)
    const payment = toMoney(amount, this.currency)
    const total = toMoney(this.total, this.currency)
    if (paid.isErr()) return err(paid.error)
    if (payment.isErr()) return err(payment.error)
    if (total.isErr()) return err(total.error)

    const cumulative = paid.value.add(payment.value)
    if (cumulative.greaterThan(total.value)) {
      return err(
        validationError(
          'PAYMENT_EXCEEDS_TOTAL',
          `Paying ${amount} would exceed the invoice total ${this.total}`,
          { paid: this.#paidAmount, total: this.total },
        ),
      )
    }

    this.#paidAmount = cumulative.toDecimal()
    this.#paymentMethod = method
    if (cumulative.equals(total.value)) {
      this.#paymentStatus = 'paid'
      this.#paidAt = at
    } else {
      this.#paymentStatus = 'partially_paid'
    }
    return ok(undefined)
  }

  /** The only exit for a wrong invoice — deletion is not one. docs/02 §3.9 */
  void(reason: string): Result<void, DomainError> {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      return err(validationError('VOID_NEEDS_REASON', 'Voiding an invoice must say why', {}))
    }
    if (this.#paymentStatus === 'void') {
      return err(validationError('INVOICE_IS_VOID', 'Already void'))
    }
    this.#paymentStatus = 'void'
    this.#voidReason = trimmed
    return ok(undefined)
  }

  /**
   * Replaces the allocation set.
   *
   * Percentage-based: amounts are derived with the exact-sum guarantee, and the
   * remainder lands on the LARGEST allocation — deterministically, so the same
   * split always produces the same halala placement. docs/02 §3.9
   */
  allocateByPercentages(
    entries: readonly { unitId: string; unitStageId: string | null; percentage: string }[],
    allocatedBy: UserId,
    at: Date,
    generateId: () => string,
  ): Result<void, DomainError> {
    if (this.#paymentStatus === 'void') {
      return err(validationError('INVOICE_IS_VOID', 'A void invoice cannot be allocated'))
    }
    if (entries.length === 0) {
      return err(validationError('ALLOCATION_NEEDS_ENTRIES', 'Allocate to at least one unit'))
    }

    let percentTotal = 0
    for (const entry of entries) {
      if (!RATE_PATTERN.test(entry.percentage) || Number(entry.percentage) <= 0) {
        return err(
          validationError('ALLOCATION_PERCENTAGE_INVALID', 'Percentages must be positive', {
            unitId: entry.unitId,
          }),
        )
      }
      percentTotal += Number(entry.percentage)
    }
    // Float addition of user-typed percentages: tolerate binary dust only.
    if (Math.abs(percentTotal - 100) > 1e-6) {
      return err(
        validationError(
          'ALLOCATION_MUST_TOTAL_100',
          `Percentages total ${String(percentTotal)}, not 100`,
          { total: percentTotal },
        ),
      )
    }

    const total = toMoney(this.total, this.currency)
    if (total.isErr()) return err(total.error)

    // Weights at 4 dp of a percent; allocateByWeights hands the remainder to
    // the EARLIEST part, so allocate in descending-weight order and map back —
    // that is what "largest gets the remainder" means mechanically.
    const weighted = entries
      .map((entry, index) => ({
        index,
        entry,
        weight: BigInt(Math.round(Number(entry.percentage) * 10_000)),
      }))
      .sort((a, b) => (a.weight === b.weight ? a.index - b.index : a.weight > b.weight ? -1 : 1))

    const shares = total.value.allocateByWeights(weighted.map((w) => w.weight))

    const allocations: CostAllocationEntry[] = new Array<CostAllocationEntry>(entries.length)
    for (const [position, share] of shares.entries()) {
      const source = weighted[position]
      if (!source) continue
      allocations[source.index] = {
        id: generateId(),
        unitId: source.entry.unitId,
        unitStageId: source.entry.unitStageId,
        amount: share.toDecimal(),
        percentage: source.entry.percentage,
        allocatedBy,
        allocatedAt: at,
      }
    }

    this.#allocations = allocations
    return ok(undefined)
  }

  /**
   * Explicit amounts: the caller does the arithmetic, this verifies it — to the
   * minor unit, no tolerance. "Off by 0.01" is exactly the bug.
   */
  allocateByAmounts(
    entries: readonly { unitId: string; unitStageId: string | null; amount: string }[],
    allocatedBy: UserId,
    at: Date,
    generateId: () => string,
  ): Result<void, DomainError> {
    if (this.#paymentStatus === 'void') {
      return err(validationError('INVOICE_IS_VOID', 'A void invoice cannot be allocated'))
    }
    if (entries.length === 0) {
      return err(validationError('ALLOCATION_NEEDS_ENTRIES', 'Allocate to at least one unit'))
    }

    let sum = Money.zero(this.currency as CurrencyCode)
    for (const entry of entries) {
      const amount = toMoney(entry.amount, this.currency)
      if (amount.isErr()) return err(amount.error)
      if (amount.value.isZero() || amount.value.isNegative()) {
        return err(
          validationError('ALLOCATION_AMOUNT_INVALID', 'Amounts must be positive', {
            unitId: entry.unitId,
          }),
        )
      }
      sum = sum.add(amount.value)
    }

    const total = toMoney(this.total, this.currency)
    if (total.isErr()) return err(total.error)
    if (!sum.equals(total.value)) {
      return err(
        validationError(
          'ALLOCATION_SUM_MISMATCH',
          `Allocations total ${sum.toDecimal()}, the invoice is ${total.value.toDecimal()}`,
          { allocated: sum.toDecimal(), invoice: total.value.toDecimal() },
        ),
      )
    }

    this.#allocations = entries.map((entry) => ({
      id: generateId(),
      unitId: entry.unitId,
      unitStageId: entry.unitStageId,
      amount: entry.amount,
      percentage: null,
      allocatedBy,
      allocatedAt: at,
    }))
    return ok(undefined)
  }

  toSnapshot(): InvoiceSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      supplierId: this.supplierId,
      poId: this.poId,
      invoiceNumber: this.invoiceNumber,
      invoiceDate: this.invoiceDate,
      dueDate: this.dueDate,
      subtotal: this.subtotal,
      taxRate: this.taxRate,
      taxAmount: this.taxAmount,
      total: this.total,
      currency: this.currency,
      paymentStatus: this.#paymentStatus,
      paidAmount: this.#paidAmount,
      paidAt: this.#paidAt,
      paymentMethod: this.#paymentMethod,
      voidReason: this.#voidReason,
      notes: this.notes,
      lines: [...this.lines],
      allocations: [...this.#allocations],
      version: this.version,
    }
  }
}
