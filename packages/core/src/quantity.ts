import { type Result, ok, err } from './result'
import { type DomainError, validationError } from './errors'

/**
 * Quantity — a decimal value bound to a unit of measure.
 *
 * The bug this exists to prevent: a supplier quotes tiles in BOXES, the BOQ is
 * in SQUARE METRES, and someone subtracts one from the other. The result looks
 * plausible, passes review, and produces a material shortage discovered on site
 * three weeks later. A bare `number` cannot stop that; a `Quantity` can.
 *
 * Stored as scaled integers (4 decimal places) for the same reason Money uses
 * minor units — consumption is recorded in fractions and accumulated across
 * hundreds of movements. docs/02 §2
 */

export type UnitOfMeasure =
  'm' | 'm2' | 'm3' | 'pcs' | 'box' | 'kg' | 'litre' | 'bag' | 'roll' | 'set' | 'man_day'

/** Everything is stored at 4 dp; site measurement never needs more. */
const SCALE = 10_000n
const PRECISION = 4

export class Quantity {
  private constructor(
    /** Value × 10^4. */
    readonly scaled: bigint,
    readonly uom: UnitOfMeasure,
  ) {}

  static zero(uom: UnitOfMeasure): Quantity {
    return new Quantity(0n, uom)
  }

  static from(value: string, uom: UnitOfMeasure): Result<Quantity, DomainError> {
    const trimmed = value.trim()
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return err(validationError('INVALID_QUANTITY', `Not a decimal quantity: ${value}`, { value }))
    }
    const negative = trimmed.startsWith('-')
    const [whole = '0', fraction = ''] = trimmed.replace('-', '').split('.')
    if (fraction.length > PRECISION) {
      return err(
        validationError(
          'QUANTITY_PRECISION_EXCEEDED',
          `Quantities allow ${PRECISION} decimal places, received ${fraction.length}`,
          { allowed: PRECISION, received: fraction.length },
        ),
      )
    }
    const scaled = BigInt(whole + fraction.padEnd(PRECISION, '0'))
    return ok(new Quantity(negative ? -scaled : scaled, uom))
  }

  private assertSameUom(other: Quantity): void {
    if (other.uom !== this.uom) {
      throw new TypeError(
        `Cannot combine ${this.uom} with ${other.uom}. Convert explicitly via the ` +
          `material's UomConversion — there is no universal box-to-m² factor.`,
      )
    }
  }

  add(other: Quantity): Quantity {
    this.assertSameUom(other)
    return new Quantity(this.scaled + other.scaled, this.uom)
  }

  subtract(other: Quantity): Quantity {
    this.assertSameUom(other)
    return new Quantity(this.scaled - other.scaled, this.uom)
  }

  /** Applies a waste factor: `withWaste('10')` adds 10 %. docs/02 §3.7 */
  withWaste(percent: string): Result<Quantity, DomainError> {
    if (!/^\d+(\.\d+)?$/.test(percent.trim())) {
      return err(
        validationError('INVALID_WASTE_FACTOR', `Not a percentage: ${percent}`, { percent }),
      )
    }
    const [whole = '0', fraction = ''] = percent.trim().split('.')
    const factorScale = BigInt(10) ** BigInt(fraction.length)
    const factor = BigInt(whole + fraction)
    const uplift = (this.scaled * factor) / (factorScale * 100n)
    return ok(new Quantity(this.scaled + uplift, this.uom))
  }

  multiply(factor: string): Result<Quantity, DomainError> {
    if (!/^-?\d+(\.\d+)?$/.test(factor.trim())) {
      return err(validationError('INVALID_FACTOR', `Not a decimal factor: ${factor}`, { factor }))
    }
    const negative = factor.trim().startsWith('-')
    const [whole = '0', fraction = ''] = factor.trim().replace('-', '').split('.')
    const factorScale = BigInt(10) ** BigInt(fraction.length)
    const product = (this.scaled * BigInt(whole + fraction)) / factorScale
    return ok(new Quantity(negative ? -product : product, this.uom))
  }

  /**
   * Converts using a material-specific factor.
   *
   * The factor is required and never inferred. One box of 60×60 tiles covers
   * 1.44 m²; one box of 30×30 covers 0.99 m². There is no global box-to-m²
   * conversion, and pretending otherwise is how quantities go wrong.
   */
  convertTo(uom: UnitOfMeasure, factor: string): Result<Quantity, DomainError> {
    return this.multiply(factor).map((q) => new Quantity(q.scaled, uom))
  }

  isZero(): boolean {
    return this.scaled === 0n
  }
  isNegative(): boolean {
    return this.scaled < 0n
  }
  greaterThan(other: Quantity): boolean {
    this.assertSameUom(other)
    return this.scaled > other.scaled
  }
  equals(other: Quantity): boolean {
    return this.uom === other.uom && this.scaled === other.scaled
  }

  toDecimal(): string {
    const negative = this.scaled < 0n
    const digits = (negative ? -this.scaled : this.scaled).toString().padStart(PRECISION + 1, '0')
    const whole = digits.slice(0, digits.length - PRECISION)
    const fraction = digits.slice(digits.length - PRECISION)
    return `${negative ? '-' : ''}${whole}.${fraction}`
  }

  toJSON(): { value: string; uom: UnitOfMeasure } {
    return { value: this.toDecimal(), uom: this.uom }
  }

  toString(): string {
    return `${this.toDecimal()} ${this.uom}`
  }
}
