import { type Result, ok, err } from './result'
import { type DomainError, validationError } from './errors'

/**
 * Money as an integer count of minor units, never a float.
 *
 * A BOQ totals ~147 lines, each multiplied by a quantity and marked up by
 * overhead, profit, and VAT. IEEE-754 accumulation error across that chain is
 * not acceptable in a document a client signs — `0.1 + 0.2 !== 0.3` becomes a
 * one-riyal discrepancy that an accountant will find and a contractor will have
 * to explain.
 *
 * Minor units also make the Gulf's three-decimal currencies representable
 * without special cases: 1 KWD is 1000 fils, exactly, and stays exact.
 * docs/02 §2, docs/12 §5.1
 */

export type CurrencyCode =
  'SAR' | 'AED' | 'EGP' | 'KWD' | 'QAR' | 'BHD' | 'OMR' | 'USD' | 'EUR' | 'GBP'

/**
 * ISO 4217 minor-unit exponents.
 *
 * KWD, BHD, and OMR have THREE decimal places. A hard-coded assumption of two —
 * the default in most codebases — produces invoices that are wrong by a factor
 * of ten in Kuwait, Bahrain, and Oman. Those are target markets.
 */
const EXPONENTS: Readonly<Record<CurrencyCode, number>> = {
  SAR: 2,
  AED: 2,
  EGP: 2,
  QAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
}

export const exponentOf = (currency: CurrencyCode): number => EXPONENTS[currency]

export class Money {
  private constructor(
    /** Integer count of minor units: fils, halalas, piastres, cents. */
    readonly minor: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency)
  }

  static fromMinor(minor: bigint | number, currency: CurrencyCode): Money {
    if (typeof minor === 'number' && !Number.isInteger(minor)) {
      throw new TypeError(`Minor units must be an integer, received ${minor}`)
    }
    return new Money(BigInt(minor), currency)
  }

  /**
   * Parses a decimal string — "1250.75", "-0.5", "1250".
   *
   * Deliberately does NOT accept a JS number. `Money.fromDecimal(0.1 + 0.2)`
   * would silently store 30 halalas instead of 30, and the whole point of this
   * class is to make that impossible. Values arrive from JSON as strings for
   * the same reason. docs/07 §2
   */
  static fromDecimal(value: string, currency: CurrencyCode): Result<Money, DomainError> {
    const trimmed = value.trim()
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return err(validationError('INVALID_MONEY', `Not a decimal amount: ${value}`, { value }))
    }

    const exponent = EXPONENTS[currency]
    const negative = trimmed.startsWith('-')
    const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.')

    if (fraction.length > exponent) {
      return err(
        validationError(
          'MONEY_PRECISION_EXCEEDED',
          `${currency} allows ${exponent} decimal places, received ${fraction.length}`,
          { currency, allowed: exponent, received: fraction.length },
        ),
      )
    }

    const padded = fraction.padEnd(exponent, '0')
    const minor = BigInt(whole + padded)
    return ok(new Money(negative ? -minor : minor, currency))
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new TypeError(
        `Cannot combine ${this.currency} with ${other.currency}. Convert explicitly ` +
          `using a dated exchange rate — implicit conversion hides which rate was used.`,
      )
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.minor + other.minor, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.minor - other.minor, this.currency)
  }

  /**
   * Multiplies by a quantity or rate given as a decimal string.
   *
   * Rounds half-away-from-zero, which is what invoices and tax authorities in
   * the target markets expect — not banker's rounding, which would make a
   * printed total disagree with a hand-checked one.
   */
  multiply(factor: string): Result<Money, DomainError> {
    if (!/^-?\d+(\.\d+)?$/.test(factor.trim())) {
      return err(validationError('INVALID_FACTOR', `Not a decimal factor: ${factor}`, { factor }))
    }
    const [whole = '0', fraction = ''] = factor.trim().replace('-', '').split('.')
    const scale = BigInt(10) ** BigInt(fraction.length)
    const scaled = BigInt(whole + fraction)
    const negative = factor.trim().startsWith('-')

    const product = this.minor * scaled
    const rounded = roundHalfAwayFromZero(product, scale)
    return ok(new Money(negative ? -rounded : rounded, this.currency))
  }

  /** Applies a percentage — VAT, markup, retention. `percent` is 0–100. */
  percentage(percent: string): Result<Money, DomainError> {
    return this.multiply(percent).andThen((m) =>
      ok(new Money(divideRound(m.minor, 100n), m.currency)),
    )
  }

  /**
   * Splits into n parts that sum EXACTLY to the original.
   *
   * Allocating a supplier invoice across units cannot lose or invent a halala:
   * 100.00 across 3 units is 33.34 + 33.33 + 33.33, not three times 33.33.
   * The remainder is distributed deterministically to the earliest parts, so
   * the same input always produces the same split. docs/02 §3.9
   */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts < 1) {
      throw new RangeError(`Parts must be a positive integer, received ${parts}`)
    }
    const n = BigInt(parts)
    const base = this.minor / n
    const remainder = this.minor - base * n
    const sign = remainder < 0n ? -1n : 1n
    const spare = remainder < 0n ? -remainder : remainder

    return Array.from(
      { length: parts },
      (_, i) => new Money(base + (BigInt(i) < spare ? sign : 0n), this.currency),
    )
  }

  /** Splits by weights (e.g. unit areas) with the same exact-sum guarantee. */
  allocateByWeights(weights: readonly bigint[]): Money[] {
    const total = weights.reduce((a, b) => a + b, 0n)
    if (total <= 0n) throw new RangeError('Weights must sum to a positive value')

    const shares = weights.map((w) => (this.minor * w) / total)
    const distributed = shares.reduce((a, b) => a + b, 0n)
    let remainder = this.minor - distributed

    return shares.map((share) => {
      if (remainder > 0n) {
        remainder -= 1n
        return new Money(share + 1n, this.currency)
      }
      if (remainder < 0n) {
        remainder += 1n
        return new Money(share - 1n, this.currency)
      }
      return new Money(share, this.currency)
    })
  }

  negate(): Money {
    return new Money(-this.minor, this.currency)
  }
  abs(): Money {
    return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency)
  }

  isZero(): boolean {
    return this.minor === 0n
  }
  isNegative(): boolean {
    return this.minor < 0n
  }
  isPositive(): boolean {
    return this.minor > 0n
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor
  }
  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other)
    return this.minor > other.minor
  }
  lessThan(other: Money): boolean {
    this.assertSameCurrency(other)
    return this.minor < other.minor
  }

  /** Canonical decimal string. This is the wire and database representation. */
  toDecimal(): string {
    const exponent = EXPONENTS[this.currency]
    const negative = this.minor < 0n
    const digits = (negative ? -this.minor : this.minor).toString().padStart(exponent + 1, '0')
    const whole = digits.slice(0, digits.length - exponent)
    const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : ''
    return `${negative ? '-' : ''}${whole}${fraction}`
  }

  /** JSON shape matching the API contract. docs/07 §2 */
  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.toDecimal(), currency: this.currency }
  }

  toString(): string {
    return `${this.toDecimal()} ${this.currency}`
  }
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  const twice = (remainder < 0n ? -remainder : remainder) * 2n
  if (twice >= denominator) return quotient + (numerator < 0n ? -1n : 1n)
  return quotient
}

const divideRound = (numerator: bigint, denominator: bigint): bigint =>
  roundHalfAwayFromZero(numerator, denominator)
