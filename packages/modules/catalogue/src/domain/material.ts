import {
  type CompanyId,
  type DomainError,
  type MaterialId,
  type Result,
  type UnitOfMeasure,
  type Quantity,
  AggregateRoot,
  err,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * Material — the catalogue entry a tenant specifies, prices and consumes.
 *
 * Its own aggregate root. A category holds thousands of materials, and loading
 * a category to edit one price would be the same mistake as putting units
 * inside a project. The consistency boundary that matters is the material and
 * its unit conversions: a conversion is meaningless without the material's base
 * unit, and both must change together or neither. docs/18 ADR-006
 */

/** Kept in step with UnitOfMeasure in @buildflow/core; a test asserts it. */
export const UNIT_OF_MEASURE_CODES = [
  'm',
  'm2',
  'm3',
  'pcs',
  'box',
  'kg',
  'litre',
  'bag',
  'roll',
  'set',
  'man_day',
] as const

/**
 * How many base units one purchase unit contains.
 *
 * Directional and material-specific. There is no global box→m², and inferring
 * one is how a tile order comes back 40% short. docs/02 §UnitOfMeasure
 */
export interface UomConversion {
  fromUom: UnitOfMeasure
  toUom: UnitOfMeasure
  /** Decimal string, up to 6 dp. Must be strictly positive. */
  factor: string
}

export interface MaterialSnapshot {
  id: MaterialId
  companyId: CompanyId
  categoryId: string
  brandId: string | null
  sku: string
  nameEn: string
  nameAr: string
  description: string | null
  baseUom: UnitOfMeasure
  defaultCost: string | null
  currency: string | null
  spec: Readonly<Record<string, unknown>> | null
  /** Null inherits the category's default. */
  wasteFactor: string | null
  knowledgeCode: string | null
  conversions: UomConversion[]
  isActive: boolean
  version: number
}

/** A material with more than a dozen purchase units is a data-entry accident. */
const MAX_CONVERSIONS = 20

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{1,63}$/
const DECIMAL_PATTERN = /^\d{1,12}(\.\d{1,6})?$/
/** Waste above this is a mistake, not a material property. */
const MAX_WASTE_PERCENT = 100

export class Material extends AggregateRoot<MaterialId> {
  #conversions: UomConversion[]
  #isActive: boolean
  #defaultCost: string | null
  #wasteFactor: string | null

  private constructor(
    id: MaterialId,
    readonly companyId: CompanyId,
    readonly categoryId: string,
    readonly brandId: string | null,
    readonly sku: string,
    readonly nameEn: string,
    readonly nameAr: string,
    readonly description: string | null,
    readonly baseUom: UnitOfMeasure,
    readonly currency: string | null,
    readonly spec: Readonly<Record<string, unknown>> | null,
    readonly knowledgeCode: string | null,
    defaultCost: string | null,
    wasteFactor: string | null,
    conversions: UomConversion[],
    isActive: boolean,
    version: number,
  ) {
    super(id, version)
    this.#conversions = conversions
    this.#isActive = isActive
    this.#defaultCost = defaultCost
    this.#wasteFactor = wasteFactor
  }

  static create(
    props: Omit<MaterialSnapshot, 'version' | 'isActive' | 'conversions'> & {
      conversions?: UomConversion[]
    },
  ): Result<Material, DomainError> {
    if (!SKU_PATTERN.test(props.sku)) {
      return err(
        validationError(
          'MATERIAL_SKU_INVALID',
          'A SKU starts alphanumeric and may contain letters, digits, dot, dash, underscore or slash',
          { sku: props.sku },
        ),
      )
    }
    if (props.nameEn.trim().length === 0 || props.nameAr.trim().length === 0) {
      return err(validationError('MATERIAL_NAME_REQUIRED', 'A material needs both names'))
    }

    const cost = validateOptionalDecimal(props.defaultCost, 'MATERIAL_COST_INVALID', 'cost')
    if (cost.isErr()) return err(cost.error)

    // A cost without a currency is a number nobody can add up, and a currency
    // without a cost is noise. docs/04 §1
    if ((props.defaultCost === null) !== (props.currency === null)) {
      return err(
        validationError(
          'MATERIAL_COST_CURRENCY_MISMATCH',
          'A default cost and its currency must be supplied together',
        ),
      )
    }

    const waste = validateWaste(props.wasteFactor)
    if (waste.isErr()) return err(waste.error)

    const conversions = props.conversions ?? []
    const checked = validateConversions(conversions, props.baseUom)
    if (checked.isErr()) return err(checked.error)

    return ok(
      new Material(
        props.id,
        props.companyId,
        props.categoryId,
        props.brandId,
        props.sku,
        props.nameEn.trim(),
        props.nameAr.trim(),
        props.description,
        props.baseUom,
        props.currency,
        props.spec,
        props.knowledgeCode,
        props.defaultCost,
        props.wasteFactor,
        conversions,
        true,
        0,
      ),
    )
  }

  static restore(snapshot: MaterialSnapshot): Material {
    return new Material(
      snapshot.id,
      snapshot.companyId,
      snapshot.categoryId,
      snapshot.brandId,
      snapshot.sku,
      snapshot.nameEn,
      snapshot.nameAr,
      snapshot.description,
      snapshot.baseUom,
      snapshot.currency,
      snapshot.spec,
      snapshot.knowledgeCode,
      snapshot.defaultCost,
      snapshot.wasteFactor,
      snapshot.conversions,
      snapshot.isActive,
      snapshot.version,
    )
  }

  get isActive(): boolean {
    return this.#isActive
  }
  get defaultCost(): string | null {
    return this.#defaultCost
  }
  get wasteFactor(): string | null {
    return this.#wasteFactor
  }
  get conversions(): readonly UomConversion[] {
    return this.#conversions
  }

  /**
   * Converts a quantity into this material's base unit.
   *
   * Everything downstream — stock, consumption, BOQ lines — is stored in the
   * base unit, so this is the single place a purchase unit becomes comparable.
   * An unknown pairing is an ERROR, never an assumed factor of 1: silently
   * treating 10 boxes as 10 m² understates a tile order by roughly 90%.
   */
  toBaseQuantity(quantity: Quantity): Result<Quantity, DomainError> {
    if (quantity.uom === this.baseUom) return ok(quantity)

    const conversion = this.#conversions.find(
      (c) => c.fromUom === quantity.uom && c.toUom === this.baseUom,
    )
    if (!conversion) {
      return err(
        validationError(
          'MATERIAL_CONVERSION_MISSING',
          `No conversion from ${quantity.uom} to ${this.baseUom} for SKU ${this.sku}`,
          { sku: this.sku, fromUom: quantity.uom, toUom: this.baseUom },
        ),
      )
    }
    return quantity.convertTo(this.baseUom, conversion.factor)
  }

  /**
   * Quantity to buy for a required amount, waste included.
   *
   * `categoryDefaultWaste` is passed in rather than read: the category is a
   * different aggregate, and reaching across to it here would make the
   * calculation untestable without a database. The material's own factor wins
   * when set — that is the whole point of having it.
   */
  purchaseQuantity(
    required: Quantity,
    categoryDefaultWaste: string,
  ): Result<Quantity, DomainError> {
    const base = this.toBaseQuantity(required)
    if (base.isErr()) return base
    return base.value.withWaste(this.#wasteFactor ?? categoryDefaultWaste)
  }

  /** Adds or replaces a conversion, keyed on the unit pair. */
  setConversion(conversion: UomConversion): Result<void, DomainError> {
    const next = [
      ...this.#conversions.filter(
        (c) => !(c.fromUom === conversion.fromUom && c.toUom === conversion.toUom),
      ),
      conversion,
    ]
    const checked = validateConversions(next, this.baseUom)
    if (checked.isErr()) return err(checked.error)

    this.#conversions = next
    return ok(undefined)
  }

  removeConversion(fromUom: UnitOfMeasure, toUom: UnitOfMeasure): void {
    this.#conversions = this.#conversions.filter(
      (c) => !(c.fromUom === fromUom && c.toUom === toUom),
    )
  }

  repriceTo(cost: string | null, currency: string | null): Result<void, DomainError> {
    const checked = validateOptionalDecimal(cost, 'MATERIAL_COST_INVALID', 'cost')
    if (checked.isErr()) return err(checked.error)
    if ((cost === null) !== (currency === null)) {
      return err(
        validationError(
          'MATERIAL_COST_CURRENCY_MISMATCH',
          'A default cost and its currency must be supplied together',
        ),
      )
    }
    this.#defaultCost = cost
    return ok(undefined)
  }

  setWasteFactor(percent: string | null): Result<void, DomainError> {
    const checked = validateWaste(percent)
    if (checked.isErr()) return err(checked.error)
    this.#wasteFactor = percent
    return ok(undefined)
  }

  /**
   * Deactivates rather than deletes.
   *
   * A material is referenced by stock movements, consumption and BOQ lines, all
   * of which are history. Removing the row would orphan them; hiding it stops
   * anyone specifying it again. docs/04 §1
   */
  deactivate(): void {
    this.#isActive = false
  }

  reactivate(): void {
    this.#isActive = true
  }

  toSnapshot(): MaterialSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      categoryId: this.categoryId,
      brandId: this.brandId,
      sku: this.sku,
      nameEn: this.nameEn,
      nameAr: this.nameAr,
      description: this.description,
      baseUom: this.baseUom,
      defaultCost: this.#defaultCost,
      currency: this.currency,
      spec: this.spec,
      wasteFactor: this.#wasteFactor,
      knowledgeCode: this.knowledgeCode,
      conversions: [...this.#conversions],
      isActive: this.#isActive,
      version: this.version,
    }
  }
}

function validateOptionalDecimal(
  value: string | null,
  code: string,
  label: string,
): Result<void, DomainError> {
  if (value === null) return ok(undefined)
  if (!DECIMAL_PATTERN.test(value)) {
    return err(validationError(code, `A ${label} must be a positive decimal`, { value }))
  }
  return ok(undefined)
}

function validateWaste(percent: string | null): Result<void, DomainError> {
  if (percent === null) return ok(undefined)
  if (!DECIMAL_PATTERN.test(percent)) {
    return err(
      validationError('MATERIAL_WASTE_INVALID', 'A waste factor must be a positive decimal', {
        value: percent,
      }),
    )
  }
  if (Number(percent) > MAX_WASTE_PERCENT) {
    return err(
      validationError(
        'MATERIAL_WASTE_OUT_OF_RANGE',
        `A waste factor above ${MAX_WASTE_PERCENT}% is a data-entry error`,
        { value: percent },
      ),
    )
  }
  return ok(undefined)
}

function validateConversions(
  conversions: readonly UomConversion[],
  baseUom: UnitOfMeasure,
): Result<void, DomainError> {
  if (conversions.length > MAX_CONVERSIONS) {
    return err(
      validationError(
        'MATERIAL_TOO_MANY_CONVERSIONS',
        `A material may define at most ${MAX_CONVERSIONS} unit conversions`,
      ),
    )
  }

  const seen = new Set<string>()
  for (const conversion of conversions) {
    if (conversion.fromUom === conversion.toUom) {
      return err(
        validationError(
          'MATERIAL_CONVERSION_IDENTITY',
          'A conversion between one unit and itself says nothing',
          { uom: conversion.fromUom },
        ),
      )
    }
    // Every conversion must land ON the base unit. Chains (box → m² → m³) would
    // need a graph search at read time and would compound rounding at each hop,
    // so the catalogue stores only direct factors.
    if (conversion.toUom !== baseUom) {
      return err(
        validationError(
          'MATERIAL_CONVERSION_NOT_TO_BASE',
          `A conversion must target the base unit ${baseUom}, not ${conversion.toUom}`,
          { baseUom, toUom: conversion.toUom },
        ),
      )
    }
    if (!DECIMAL_PATTERN.test(conversion.factor) || Number(conversion.factor) <= 0) {
      return err(
        validationError(
          'MATERIAL_CONVERSION_FACTOR_INVALID',
          'A conversion factor must be a positive decimal with at most 6 decimal places',
          { factor: conversion.factor },
        ),
      )
    }

    const key = `${conversion.fromUom}>${conversion.toUom}`
    if (seen.has(key)) {
      return err(
        validationError('MATERIAL_CONVERSION_DUPLICATE', `Duplicate conversion ${key}`, { key }),
      )
    }
    seen.add(key)
  }
  return ok(undefined)
}
