import {
  type BudgetId,
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type Money,
  type Result,
  type UserId,
  AggregateRoot,
  err,
  exponentOf,
  ok,
  validationError,
} from '@buildflow/core'
import { toMoney } from './money-math'

/**
 * Budget — the baseline a variance argument stands on.
 *
 * APPEND-ONLY REVISIONS, the same discipline as the stock ledger and for the
 * same reason: "the budget was 80k when we started and someone raised it to
 * 95k in March" is the sentence the argument turns on, and a mutated row
 * cannot say it. The current budget for a scope is its highest revision;
 * every earlier baseline stays readable. There is no update and no delete —
 * a Budget instance is immutable, and `revise` returns a NEW aggregate.
 */

export interface BudgetBuckets {
  materialBudget: string
  labourBudget: string
  equipmentBudget: string
  overheadBudget: string
}

export interface BudgetSnapshot extends BudgetBuckets {
  id: BudgetId
  companyId: CompanyId
  unitId: string
  /** NULL = the whole-unit budget. Stage budgets refine it, never replace it. */
  unitStageId: string | null
  boqId: string | null
  totalBudget: string
  currency: string
  baselineAt: Date
  revision: number
  approvedBy: UserId
  revisionReason: string | null
}

const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,4})?$/

const BUCKETS = [
  'materialBudget',
  'labourBudget',
  'equipmentBudget',
  'overheadBudget',
] as const satisfies readonly (keyof BudgetBuckets)[]

export class Budget extends AggregateRoot<BudgetId> {
  private constructor(
    id: BudgetId,
    readonly companyId: CompanyId,
    readonly unitId: string,
    readonly unitStageId: string | null,
    readonly boqId: string | null,
    readonly materialBudget: string,
    readonly labourBudget: string,
    readonly equipmentBudget: string,
    readonly overheadBudget: string,
    readonly totalBudget: string,
    readonly currency: string,
    readonly baselineAt: Date,
    readonly revision: number,
    readonly approvedBy: UserId,
    readonly revisionReason: string | null,
  ) {
    super(id, 0)
  }

  /**
   * Revision 1. The total is DERIVED as the sum of the buckets and stored, so
   * the printed baseline survives any later change to how buckets are defined.
   * A reason is free here; it becomes mandatory the moment history exists.
   */
  static baseline(props: {
    id: BudgetId
    companyId: CompanyId
    unitId: string
    unitStageId: string | null
    boqId: string | null
    buckets: BudgetBuckets
    currency: string
    baselineAt: Date
    approvedBy: UserId
    revisionReason?: string | null
  }): Result<Budget, DomainError> {
    const derived = deriveTotals(props.buckets, props.currency)
    if (derived.isErr()) return err(derived.error)

    return ok(
      new Budget(
        props.id,
        props.companyId,
        props.unitId,
        props.unitStageId,
        props.boqId,
        derived.value.buckets.materialBudget,
        derived.value.buckets.labourBudget,
        derived.value.buckets.equipmentBudget,
        derived.value.buckets.overheadBudget,
        derived.value.total,
        props.currency,
        props.baselineAt,
        1,
        props.approvedBy,
        normalizeReason(props.revisionReason ?? null),
      ),
    )
  }

  /**
   * The next revision of THIS scope. Requires the honest answer to "why did
   * the number move" — a baseline that changes without a stated reason is the
   * hole every variance meeting falls into. Currency is carried forward, not
   * accepted: a scope whose baseline drifts between currencies mid-history has
   * no comparable revisions at all.
   */
  revise(props: {
    id: BudgetId
    buckets: BudgetBuckets
    boqId: string | null
    baselineAt: Date
    approvedBy: UserId
    revisionReason: string
  }): Result<Budget, DomainError> {
    const reason = normalizeReason(props.revisionReason)
    if (!reason) {
      return err(
        validationError('BUDGET_REVISION_NEEDS_REASON', 'Revising a baseline must say why'),
      )
    }

    const derived = deriveTotals(props.buckets, this.currency)
    if (derived.isErr()) return err(derived.error)

    const unchanged =
      BUCKETS.every((bucket) => derived.value.buckets[bucket] === this[bucket]) &&
      props.boqId === this.boqId
    if (unchanged) {
      return err(
        validationError(
          'BUDGET_REVISION_UNCHANGED',
          'This revision changes nothing — the current baseline already says this',
          { revision: this.revision },
        ),
      )
    }

    return ok(
      new Budget(
        props.id,
        this.companyId,
        this.unitId,
        this.unitStageId,
        props.boqId,
        derived.value.buckets.materialBudget,
        derived.value.buckets.labourBudget,
        derived.value.buckets.equipmentBudget,
        derived.value.buckets.overheadBudget,
        derived.value.total,
        this.currency,
        props.baselineAt,
        this.revision + 1,
        props.approvedBy,
        reason,
      ),
    )
  }

  static restore(snapshot: BudgetSnapshot): Budget {
    return new Budget(
      snapshot.id,
      snapshot.companyId,
      snapshot.unitId,
      snapshot.unitStageId,
      snapshot.boqId,
      snapshot.materialBudget,
      snapshot.labourBudget,
      snapshot.equipmentBudget,
      snapshot.overheadBudget,
      snapshot.totalBudget,
      snapshot.currency,
      snapshot.baselineAt,
      snapshot.revision,
      snapshot.approvedBy,
      snapshot.revisionReason,
    )
  }

  toSnapshot(): BudgetSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      unitId: this.unitId,
      unitStageId: this.unitStageId,
      boqId: this.boqId,
      materialBudget: this.materialBudget,
      labourBudget: this.labourBudget,
      equipmentBudget: this.equipmentBudget,
      overheadBudget: this.overheadBudget,
      totalBudget: this.totalBudget,
      currency: this.currency,
      baselineAt: this.baselineAt,
      revision: this.revision,
      approvedBy: this.approvedBy,
      revisionReason: this.revisionReason,
    }
  }
}

const normalizeReason = (reason: string | null): string | null => {
  const trimmed = reason?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Validates the buckets and derives the total. Buckets are money — payable at
 * the currency's minor unit, non-negative, zero allowed per bucket (a budget
 * with no equipment line is normal). The TOTAL must be positive: a baseline of
 * nothing baselines nothing, and every division downstream would agree.
 */
function deriveTotals(
  buckets: BudgetBuckets,
  currency: string,
): Result<{ buckets: BudgetBuckets; total: string }, DomainError> {
  if (!Number.isInteger(exponentOf(currency as CurrencyCode))) {
    return err(validationError('INVALID_CURRENCY', `Unknown currency ${currency}`, { currency }))
  }

  const parsed: Money[] = []
  for (const bucket of BUCKETS) {
    const value = buckets[bucket]
    if (!DECIMAL_PATTERN.test(value)) {
      return err(
        validationError('BUDGET_AMOUNT_INVALID', 'Budget amounts are non-negative decimals', {
          bucket,
          value,
        }),
      )
    }
    const money = toMoney(value, currency)
    if (money.isErr()) return err(money.error)
    parsed.push(money.value)
  }
  const [material, labour, equipment, overhead] = parsed
  if (!material || !labour || !equipment || !overhead) {
    return err(validationError('BUDGET_AMOUNT_INVALID', 'All four buckets are required', {}))
  }

  const total = material.add(labour).add(equipment).add(overhead)

  if (!total.isPositive()) {
    return err(validationError('BUDGET_MUST_BE_POSITIVE', 'A budget of zero baselines nothing', {}))
  }

  return ok({
    buckets: {
      materialBudget: material.toDecimal(),
      labourBudget: labour.toDecimal(),
      equipmentBudget: equipment.toDecimal(),
      overheadBudget: overhead.toDecimal(),
    },
    total: total.toDecimal(),
  })
}
