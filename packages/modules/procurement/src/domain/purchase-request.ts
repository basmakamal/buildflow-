import { extendLine } from './money-math'
import {
  type CompanyId,
  type DomainError,
  type Result,
  type UnitOfMeasure,
  type UserId,
  type PurchaseRequestId,
  AggregateRoot,
  Money,
  type CurrencyCode,
  err,
  forbiddenError,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * PurchaseRequest — the approval-gated ask that precedes spending money.
 *
 * The state machine is the point: material cost is the largest controllable
 * spend in finishing work, and the request/approve split is the control. The
 * one rule that cannot be a UI concern is SELF_APPROVAL — the person asking for
 * the money may not be the person releasing it, no matter what permissions
 * their tenant handed them. Same pattern as stage approval. docs/11 §3
 */

export type PurchaseRequestStatus =
  'draft' | 'submitted' | 'approved' | 'rejected' | 'converted' | 'cancelled'

const TRANSITIONS: Readonly<Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]>> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'cancelled'],
  // A rejected request goes back to the drawing board, not the bin: the lines
  // are usually right and the quantities wrong.
  rejected: ['submitted', 'cancelled'],
  approved: ['converted', 'cancelled'],
  converted: [],
  cancelled: [],
}

export interface RequestLine {
  id: string
  materialId: string
  description: string | null
  /** Decimal string, 4 dp, in the unit the requester thinks in. */
  quantity: string
  uom: UnitOfMeasure
  estimatedUnitPrice: string | null
  note: string | null
}

export interface PurchaseRequestSnapshot {
  id: PurchaseRequestId
  companyId: CompanyId
  projectId: string
  unitId: string | null
  unitStageId: string | null
  requestNumber: string
  status: PurchaseRequestStatus
  requestedBy: UserId
  requestedAt: Date
  requiredByDate: Date | null
  approvedBy: UserId | null
  approvedAt: Date | null
  rejectionReason: string | null
  totalEstimated: string
  currency: string
  lines: RequestLine[]
  version: number
}

/** A request with hundreds of lines is a BOQ, and belongs in Phase 4. */
const MAX_LINES = 100
const QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/

export class PurchaseRequest extends AggregateRoot<PurchaseRequestId> {
  #status: PurchaseRequestStatus
  #approvedBy: UserId | null
  #approvedAt: Date | null
  #rejectionReason: string | null

  private constructor(
    id: PurchaseRequestId,
    readonly companyId: CompanyId,
    readonly projectId: string,
    readonly unitId: string | null,
    readonly unitStageId: string | null,
    readonly requestNumber: string,
    readonly requestedBy: UserId,
    readonly requestedAt: Date,
    readonly requiredByDate: Date | null,
    readonly currency: string,
    readonly lines: readonly RequestLine[],
    status: PurchaseRequestStatus,
    approvedBy: UserId | null,
    approvedAt: Date | null,
    rejectionReason: string | null,
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#approvedBy = approvedBy
    this.#approvedAt = approvedAt
    this.#rejectionReason = rejectionReason
  }

  static create(
    props: Omit<
      PurchaseRequestSnapshot,
      'status' | 'approvedBy' | 'approvedAt' | 'rejectionReason' | 'totalEstimated' | 'version'
    >,
  ): Result<PurchaseRequest, DomainError> {
    if (props.lines.length === 0) {
      return err(
        validationError('REQUEST_NEEDS_LINES', 'A purchase request needs at least one line'),
      )
    }
    if (props.lines.length > MAX_LINES) {
      return err(
        validationError('REQUEST_TOO_MANY_LINES', `At most ${MAX_LINES} lines per request`),
      )
    }
    for (const line of props.lines) {
      if (!QUANTITY_PATTERN.test(line.quantity) || Number(line.quantity) <= 0) {
        return err(
          validationError('REQUEST_QUANTITY_INVALID', 'Line quantities must be positive decimals', {
            materialId: line.materialId,
          }),
        )
      }
      if (line.estimatedUnitPrice !== null && !QUANTITY_PATTERN.test(line.estimatedUnitPrice)) {
        return err(
          validationError('REQUEST_PRICE_INVALID', 'Estimated prices must be positive decimals', {
            materialId: line.materialId,
          }),
        )
      }
    }

    return ok(
      new PurchaseRequest(
        props.id,
        props.companyId,
        props.projectId,
        props.unitId,
        props.unitStageId,
        props.requestNumber,
        props.requestedBy,
        props.requestedAt,
        props.requiredByDate,
        props.currency,
        props.lines,
        'draft',
        null,
        null,
        null,
        0,
      ),
    )
  }

  static restore(snapshot: PurchaseRequestSnapshot): PurchaseRequest {
    return new PurchaseRequest(
      snapshot.id,
      snapshot.companyId,
      snapshot.projectId,
      snapshot.unitId,
      snapshot.unitStageId,
      snapshot.requestNumber,
      snapshot.requestedBy,
      snapshot.requestedAt,
      snapshot.requiredByDate,
      snapshot.currency,
      snapshot.lines,
      snapshot.status,
      snapshot.approvedBy,
      snapshot.approvedAt,
      snapshot.rejectionReason,
      snapshot.version,
    )
  }

  get status(): PurchaseRequestStatus {
    return this.#status
  }
  get approvedBy(): UserId | null {
    return this.#approvedBy
  }
  get rejectionReason(): string | null {
    return this.#rejectionReason
  }

  /**
   * Σ(quantity × estimated price) over the priced lines, exact minor-unit
   * arithmetic via Money. Unpriced lines contribute zero rather than blocking:
   * a site engineer often knows WHAT is needed before anyone knows the price.
   */
  totalEstimated(): Result<string, DomainError> {
    let total = Money.zero(this.currency as CurrencyCode)
    for (const line of this.lines) {
      if (line.estimatedUnitPrice === null) continue
      const extended = extendLine(line.quantity, line.estimatedUnitPrice, this.currency)
      if (extended.isErr()) return err(extended.error)
      total = total.add(extended.value)
    }
    return ok(total.toDecimal())
  }

  submit(): Result<void, DomainError> {
    return this.transition('submitted')
  }

  /**
   * SELF_APPROVAL is checked against the REQUESTER, not the last editor: the
   * request is the ask, and the asker releasing their own spend is the fraud
   * pattern this exists to stop. docs/11 §3
   */
  approve(actor: UserId, at: Date): Result<void, DomainError> {
    if (actor === this.requestedBy) {
      return err(
        forbiddenError(
          'SELF_APPROVAL',
          'The person who requested a purchase cannot also approve it',
        ),
      )
    }
    const result = this.transition('approved')
    if (result.isErr()) return result
    this.#approvedBy = actor
    this.#approvedAt = at
    this.#rejectionReason = null
    return ok(undefined)
  }

  reject(reason: string): Result<void, DomainError> {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      return err(
        validationError('REJECTION_NEEDS_REASON', 'A rejection must say why, or nobody can fix it'),
      )
    }
    const result = this.transition('rejected')
    if (result.isErr()) return result
    this.#rejectionReason = trimmed
    this.#approvedBy = null
    this.#approvedAt = null
    return ok(undefined)
  }

  /** Called when a purchase order is created from this request. */
  markConverted(): Result<void, DomainError> {
    return this.transition('converted')
  }

  cancel(): Result<void, DomainError> {
    return this.transition('cancelled')
  }

  private transition(next: PurchaseRequestStatus): Result<void, DomainError> {
    if (!TRANSITIONS[this.#status].includes(next)) {
      return err(
        validationError(
          'INVALID_REQUEST_TRANSITION',
          `A ${this.#status} request cannot become ${next}`,
          { from: this.#status, to: next },
        ),
      )
    }
    this.#status = next
    return ok(undefined)
  }

  toSnapshot(): PurchaseRequestSnapshot {
    const total = this.totalEstimated()
    return {
      id: this.id,
      companyId: this.companyId,
      projectId: this.projectId,
      unitId: this.unitId,
      unitStageId: this.unitStageId,
      requestNumber: this.requestNumber,
      status: this.#status,
      requestedBy: this.requestedBy,
      requestedAt: this.requestedAt,
      requiredByDate: this.requiredByDate,
      approvedBy: this.#approvedBy,
      approvedAt: this.#approvedAt,
      rejectionReason: this.#rejectionReason,
      totalEstimated: total.isOk() ? total.value : '0.0000',
      currency: this.currency,
      lines: [...this.lines],
      version: this.version,
    }
  }
}
