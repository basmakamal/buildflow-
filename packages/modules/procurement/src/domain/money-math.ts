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
 * The seam between 4-dp commercial numbers and 2-dp money.
 *
 * Unit prices are quoted at 4 decimal places (docs/04: DECIMAL(18,4)) because a
 * cable priced per metre or a tile priced per m² legitimately carries sub-minor
 * precision — 0.8525 SAR/m is a real quote. Money, correctly, refuses anything
 * finer than the currency's minor unit. So the rule is: prices stay 4-dp until
 * they are EXTENDED by a quantity, and the rounding to money happens exactly
 * once, on the line total. Rounding each factor first compounds; rounding once
 * per line is what the printed invoice will show.
 */

const SCALE = 4
const SCALE_FACTOR = 10n ** BigInt(SCALE)

function toScaled4(decimal: string): bigint {
  const [whole = '0', fraction = ''] = decimal.split('.')
  return BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE))
}

/**
 * quantity × unitPrice → Money, rounding half-away-from-zero at the currency's
 * exponent — the same rounding Money itself uses, for the same reason: a
 * printed total must survive a hand check.
 */
export function extendLine(
  quantity: string,
  unitPrice: string,
  currency: string,
): Result<Money, DomainError> {
  // CurrencyCode is a closed union, so a cast from an unchecked string could
  // still index outside the map at runtime — hence the Number.isInteger guard
  // rather than an undefined comparison the type system rejects as impossible.
  const exponent = exponentOf(currency as CurrencyCode)
  if (!Number.isInteger(exponent)) {
    return err(validationError('INVALID_CURRENCY', `Unknown currency ${currency}`, { currency }))
  }

  // 4 dp × 4 dp = 8 dp intermediate; divide back to minor units, rounding once.
  const product = toScaled4(quantity) * toScaled4(unitPrice)
  const divisor = (SCALE_FACTOR * SCALE_FACTOR) / 10n ** BigInt(exponent)
  const minor = (product + divisor / 2n) / divisor

  return ok(Money.fromMinor(minor, currency as CurrencyCode))
}

/**
 * Parses a stored money string that may carry cosmetic trailing zeros.
 *
 * The database column is DECIMAL(18,4), so a SAR amount reads back as
 * "825.0000" — same value, too many places for Money's strictness. Trailing
 * zeros are trimmed; REAL sub-minor precision still fails, because a tax amount
 * of 0.005 SAR is not money anyone can pay.
 */
export function toMoney(value: string, currency: string): Result<Money, DomainError> {
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
  return Money.fromDecimal(
    trimmed === '' || trimmed === '-' ? '0' : trimmed,
    currency as CurrencyCode,
  )
}
