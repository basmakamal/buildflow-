import {
  type DomainError,
  type Result,
  type UnitOfMeasure,
  err,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * The stock ledger's pure core: movement rules and the balance fold.
 *
 * Everything here is arithmetic over an ordered list of immutable movements.
 * The projection table in the database is a cache of `foldBalance`, never a
 * second source of truth — reconciliation replays the ledger through this same
 * function and any disagreement is, by construction, the projection's fault.
 * docs/02 §3.9
 */

export const STOCK_MOVEMENT_TYPES = [
  'purchase_receipt',
  'consumption',
  'return_to_supplier',
  'transfer_in',
  'transfer_out',
  'wastage',
  'adjustment',
  'opening_balance',
] as const
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number]

export type StockDirection = 'in' | 'out'

/**
 * The direction each movement type implies. `adjustment` is absent on purpose:
 * it is the one type that can go either way, so the caller must say which —
 * everywhere else, letting callers pick a direction is an invitation to record
 * a consumption as `in` and inflate stock.
 */
const FIXED_DIRECTION: Readonly<Partial<Record<StockMovementType, StockDirection>>> = {
  purchase_receipt: 'in',
  transfer_in: 'in',
  opening_balance: 'in',
  consumption: 'out',
  return_to_supplier: 'out',
  transfer_out: 'out',
  wastage: 'out',
}

export function directionFor(
  type: StockMovementType,
  requested?: StockDirection,
): Result<StockDirection, DomainError> {
  const fixed = FIXED_DIRECTION[type]
  if (fixed) {
    if (requested !== undefined && requested !== fixed) {
      return err(
        validationError('STOCK_DIRECTION_CONTRADICTS_TYPE', `A ${type} is always "${fixed}"`, {
          type,
          requested,
        }),
      )
    }
    return ok(fixed)
  }
  if (requested === undefined) {
    return err(
      validationError(
        'STOCK_DIRECTION_REQUIRED',
        'An adjustment must state its direction explicitly',
        { type },
      ),
    )
  }
  return ok(requested)
}

export interface MovementRecord {
  type: StockMovementType
  direction: StockDirection
  /** Decimal string, 4 dp, in the material's BASE unit. Strictly positive. */
  quantity: string
  totalCost: string | null
  occurredAt: Date
  reversalOfMovementId: string | null
}

export interface StockBalance {
  purchased: string
  used: string
  wasted: string
  returned: string
  /** Σ(in) − Σ(out). Never a mutated counter. */
  remaining: string
  /** Σ(totalCost of inbound) − Σ(totalCost of reversals of inbound). */
  actualCost: string
  lastMovementAt: Date | null
}

/** Scaled-integer arithmetic (4 dp), same discipline as core's Quantity. */
function toScaled(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.split('.')
  const negative = whole.startsWith('-')
  const digits = (negative ? whole.slice(1) : whole) + fraction.padEnd(4, '0').slice(0, 4)
  const value = BigInt(digits)
  return negative ? -value : value
}

function toDecimal(scaled: bigint): string {
  const negative = scaled < 0n
  const digits = (negative ? -scaled : scaled).toString().padStart(5, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`
}

const QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/

export function validateQuantity(quantity: string): Result<void, DomainError> {
  if (!QUANTITY_PATTERN.test(quantity) || toScaled(quantity) <= 0n) {
    return err(
      validationError(
        'STOCK_QUANTITY_INVALID',
        'A movement quantity must be a positive decimal with at most 4 decimal places',
        { quantity },
      ),
    )
  }
  return ok(undefined)
}

/**
 * Replays a ledger into its balance.
 *
 * A reversal contributes to the SAME bucket as the movement it reverses, with
 * its sign flipped by its own direction — a reversed consumption is an `in`
 * movement of type consumption, so `used` goes back down and `remaining` back
 * up. This is why reversals carry the original's type rather than being
 * adjustments: the buckets stay honest per type.
 */
export function foldBalance(movements: readonly MovementRecord[]): StockBalance {
  let purchased = 0n
  let used = 0n
  let wasted = 0n
  let returned = 0n
  let remaining = 0n
  let actualCost = 0n
  let lastMovementAt: Date | null = null

  for (const movement of movements) {
    const quantity = toScaled(movement.quantity)
    const signed = movement.direction === 'in' ? quantity : -quantity

    remaining += signed

    switch (movement.type) {
      case 'purchase_receipt':
      case 'opening_balance':
        // A reversal of an inbound is direction 'out' and subtracts here.
        purchased += signed
        break
      case 'consumption':
        used -= signed
        break
      case 'wastage':
        wasted -= signed
        break
      case 'return_to_supplier':
        returned -= signed
        break
      case 'transfer_in':
      case 'transfer_out':
      case 'adjustment':
        // Affect remaining only: a transfer is not a purchase and not a use,
        // and an adjustment is a correction of count, not of consumption.
        break
    }

    if (
      movement.totalCost !== null &&
      (movement.type === 'purchase_receipt' || movement.type === 'opening_balance')
    ) {
      const cost = toScaled(movement.totalCost)
      actualCost += movement.direction === 'in' ? cost : -cost
    }

    if (lastMovementAt === null || movement.occurredAt > lastMovementAt) {
      lastMovementAt = movement.occurredAt
    }
  }

  return {
    purchased: toDecimal(purchased),
    used: toDecimal(used),
    wasted: toDecimal(wasted),
    returned: toDecimal(returned),
    remaining: toDecimal(remaining),
    actualCost: toDecimal(actualCost),
    lastMovementAt,
  }
}

/**
 * Whether appending a movement would drive `remaining` negative.
 *
 * Checked against the replayed ledger, not a counter. Consuming more than is on
 * site is usually a data-entry error, so it is refused unless the tenant has
 * explicitly said their site practice runs ahead of their paperwork
 * (`negativeStockAllowed`). docs/02 §3.9
 */
export function wouldGoNegative(current: StockBalance, movement: MovementRecord): boolean {
  if (movement.direction === 'in') return false
  return toScaled(current.remaining) - toScaled(movement.quantity) < 0n
}

/**
 * Builds the correcting entry for a movement. The original is never touched:
 * the reversal flips the direction, keeps the type and magnitude, and points
 * back — so the ledger explains its own corrections.
 */
export function reversalOf(original: {
  id: string
  type: StockMovementType
  direction: StockDirection
  quantity: string
  totalCost: string | null
  uom: UnitOfMeasure
}): {
  type: StockMovementType
  direction: StockDirection
  quantity: string
  totalCost: string | null
  uom: UnitOfMeasure
  reversalOfMovementId: string
} {
  return {
    type: original.type,
    direction: original.direction === 'in' ? 'out' : 'in',
    quantity: original.quantity,
    totalCost: original.totalCost,
    uom: original.uom,
    reversalOfMovementId: original.id,
  }
}
