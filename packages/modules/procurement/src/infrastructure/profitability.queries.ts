import type { Database } from '@buildflow/database'
import { type CurrencyCode, Money, exponentOf } from '@buildflow/core'

/**
 * The first profitability report. Phase 3 sprint 8 exit criterion: an owner can
 * answer "did unit 305 make money, and where did it leak?" from the product.
 *
 * The report joins the two numbers this phase spent seven sprints making
 * trustworthy: the BASELINE (latest budget revision per scope, append-only) and
 * the ACTUAL (Σ cost allocations of non-void invoices, exact to the minor
 * unit). Variance is their difference, computed here and nowhere else.
 *
 * Currency discipline: everything is reported in the UNIT's currency. Actuals
 * booked in any other currency are LISTED, never converted — implicit
 * conversion hides which rate was used, and a rate nobody chose is how two
 * reports of the same unit disagree. docs/02 §2
 */

export interface ScopeBudget {
  revision: number
  baselineAt: Date
  materialBudget: string
  labourBudget: string
  equipmentBudget: string
  overheadBudget: string
  totalBudget: string
}

export interface ScopeVariance {
  budget: ScopeBudget | null
  actualCost: string
  /** budget − actual; negative means overrun. Null without a baseline. */
  variance: string | null
  /** Percent of budget consumed, 2 dp. Null without a baseline. */
  budgetUtilization: string | null
  overBudget: boolean
}

export interface ProfitabilityReport extends ScopeVariance {
  unitId: string
  currency: string
  stages: ({ unitStageId: string } & ScopeVariance)[]
  /** Actuals in other currencies — visible, unconverted, never summed in. */
  foreignActuals: { currency: string; amount: string }[]
}

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class ProfitabilityQueries {
  constructor(private readonly db: Database) {}

  /** Null when the unit does not exist (or is deleted) — the route 404s. */
  async forUnit(unitId: string): Promise<ProfitabilityReport | null> {
    const unit = await this.db.unit.findFirst({
      where: { id: unitId, deletedAt: null },
      select: { id: true, currency: true },
    })
    if (!unit) return null

    const currency = unit.currency as CurrencyCode
    const exponent = exponentOf(currency)
    const money = (value: unknown): Money => {
      const parsed = Money.fromDecimal(fixed(value, exponent), currency)
      if (parsed.isErr()) {
        throw new Error(`Unreadable amount in profitability query: ${String(value)}`)
      }
      return parsed.value
    }

    // Latest revision per scope. Ordered ascending, so the last row seen for a
    // stageKey is the highest revision — the Map does the "latest" for us.
    const budgetRows = await this.db.budget.findMany({
      where: { unitId },
      orderBy: { revision: 'asc' },
    })
    const latestByScope = new Map<string, (typeof budgetRows)[number]>()
    for (const row of budgetRows) latestByScope.set(row.stageKey, row)

    const allocations = await this.db.costAllocation.findMany({
      where: { unitId, invoice: { paymentStatus: { not: 'void' } } },
      include: { invoice: { select: { currency: true } } },
    })

    let unitActual = Money.zero(currency)
    const stageActuals = new Map<string, Money>()
    const foreign = new Map<string, Money>()
    for (const allocation of allocations) {
      const allocationCurrency = allocation.invoice.currency as CurrencyCode
      if (allocationCurrency !== currency) {
        const amount = Money.fromDecimal(
          fixed(allocation.amount, exponentOf(allocationCurrency)),
          allocationCurrency,
        )
        if (amount.isOk()) {
          foreign.set(
            allocationCurrency,
            (foreign.get(allocationCurrency) ?? Money.zero(allocationCurrency)).add(amount.value),
          )
        }
        continue
      }
      const amount = money(allocation.amount)
      unitActual = unitActual.add(amount)
      if (allocation.unitStageId) {
        stageActuals.set(
          allocation.unitStageId,
          (stageActuals.get(allocation.unitStageId) ?? Money.zero(currency)).add(amount),
        )
      }
    }

    const scope = (
      budgetRow: (typeof budgetRows)[number] | undefined,
      actual: Money,
    ): ScopeVariance => {
      if (!budgetRow) {
        return {
          budget: null,
          actualCost: actual.toDecimal(),
          variance: null,
          budgetUtilization: null,
          // Money spent against no baseline at all is over budget by any
          // honest reading — zero was approved.
          overBudget: actual.isPositive(),
        }
      }
      const total = money(budgetRow.totalBudget)
      const variance = total.subtract(actual)
      return {
        budget: {
          revision: budgetRow.revision,
          baselineAt: budgetRow.baselineAt,
          materialBudget: fixed(budgetRow.materialBudget, exponent),
          labourBudget: fixed(budgetRow.labourBudget, exponent),
          equipmentBudget: fixed(budgetRow.equipmentBudget, exponent),
          overheadBudget: fixed(budgetRow.overheadBudget, exponent),
          totalBudget: total.toDecimal(),
        },
        actualCost: actual.toDecimal(),
        variance: variance.toDecimal(),
        budgetUtilization: utilizationPercent(actual, total),
        overBudget: variance.isNegative(),
      }
    }

    // Every stage that has a budget OR an actual appears. A stage with spend
    // and no baseline is precisely the leak the owner is looking for.
    const stageKeys = new Set<string>()
    for (const key of latestByScope.keys()) if (key !== '') stageKeys.add(key)
    for (const key of stageActuals.keys()) stageKeys.add(key)

    return {
      unitId: unit.id,
      currency,
      ...scope(latestByScope.get(''), unitActual),
      stages: [...stageKeys].sort().map((unitStageId) => ({
        unitStageId,
        ...scope(
          latestByScope.get(unitStageId),
          stageActuals.get(unitStageId) ?? Money.zero(currency),
        ),
      })),
      foreignActuals: [...foreign.entries()].map(([foreignCurrency, amount]) => ({
        currency: foreignCurrency,
        amount: amount.toDecimal(),
      })),
    }
  }
}

/** actual / budget as a percentage, 2 dp, computed in integer basis points. */
function utilizationPercent(actual: Money, budget: Money): string {
  const basisPoints = (actual.minor * 10_000n + budget.minor / 2n) / budget.minor
  const negative = basisPoints < 0n
  const digits = (negative ? -basisPoints : basisPoints).toString().padStart(3, '0')
  const whole = digits.slice(0, -2)
  const frac = digits.slice(-2)
  return `${negative ? '-' : ''}${whole}.${frac}`
}
