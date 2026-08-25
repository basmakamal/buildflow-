import {
  type CurrencyCode,
  type DomainError,
  type Result,
  Money,
  err,
  exponentOf,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * The seam between 4-dp quantities/rates and money — the estimation module's
 * counterpart of procurement's line-extension rule (module boundaries forbid
 * importing it): quantities and rates stay 4-dp until they are extended, and
 * the rounding to the currency's minor unit happens exactly ONCE, on the
 * extended amount. Rounding each factor first compounds; rounding once per
 * extension is what the printed BOQ line will show.
 */

const SCALE = 4
const SCALE_FACTOR = 10n ** BigInt(SCALE)

function toScaled4(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.split('.')
  return BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE))
}

/** quantity × rate → Money, rounded half-away-from-zero at the minor unit. */
export function extendRate(
  quantity: string,
  rate: string,
  currency: string,
): Result<Money, DomainError> {
  const exponent = exponentOf(currency as CurrencyCode)
  if (!Number.isInteger(exponent)) {
    return err(validationError('INVALID_CURRENCY', `Unknown currency ${currency}`, { currency }))
  }
  const product = toScaled4(quantity) * toScaled4(rate)
  const divisor = (SCALE_FACTOR * SCALE_FACTOR) / 10n ** BigInt(exponent)
  const minor = (product + divisor / 2n) / divisor
  return ok(Money.fromMinor(minor, currency as CurrencyCode))
}
