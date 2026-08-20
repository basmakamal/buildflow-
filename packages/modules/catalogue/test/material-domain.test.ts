import { describe, expect, it } from 'vitest'
import { type CompanyId, type MaterialId, type UnitOfMeasure, Quantity } from '@buildflow/core'
import { Material, UNIT_OF_MEASURE_CODES, type MaterialSnapshot } from '../src/domain/material'

/**
 * The conversion rules carry the weight here. A wrong factor does not throw —
 * it produces a plausible number that under-orders a job, and the error only
 * surfaces when the tiles run out on site.
 */

const base = (over: Partial<MaterialSnapshot> = {}): MaterialSnapshot => ({
  id: 'mat-1' as MaterialId,
  companyId: 'co-1' as CompanyId,
  categoryId: 'cat-flooring',
  brandId: null,
  sku: 'POR-60',
  nameEn: 'Porcelain 60x60',
  nameAr: 'بورسلان ٦٠×٦٠',
  description: null,
  baseUom: 'm2',
  defaultCost: '55.0000',
  currency: 'SAR',
  spec: null,
  wasteFactor: null,
  knowledgeCode: 'flr_porcelain_60',
  conversions: [{ fromUom: 'box', toUom: 'm2', factor: '1.44' }],
  isActive: true,
  version: 0,
  ...over,
})

const material = (over: Partial<MaterialSnapshot> = {}) => Material.restore(base(over))

const qty = (value: string, uom: UnitOfMeasure) => {
  const result = Quantity.from(value, uom)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value
}

describe('unit of measure vocabulary', () => {
  /**
   * The Prisma enum and this list are separate declarations of the same set. A
   * code in one and not the other becomes a runtime cast that fails on real
   * data rather than in CI.
   */
  it('matches the core UnitOfMeasure type exactly', () => {
    const fromCore: UnitOfMeasure[] = [
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
    ]
    expect([...UNIT_OF_MEASURE_CODES].sort()).toEqual([...fromCore].sort())
  })
})

describe('Material.create', () => {
  it('accepts a well-formed material', () => {
    const {
      id,
      companyId,
      categoryId,
      brandId,
      sku,
      nameEn,
      nameAr,
      description,
      baseUom,
      defaultCost,
      currency,
      spec,
      wasteFactor,
      knowledgeCode,
    } = base()
    const result = Material.create({
      id,
      companyId,
      categoryId,
      brandId,
      sku,
      nameEn,
      nameAr,
      description,
      baseUom,
      defaultCost,
      currency,
      spec,
      wasteFactor,
      knowledgeCode,
      conversions: [{ fromUom: 'box', toUom: 'm2', factor: '1.44' }],
    })
    expect(result.isOk()).toBe(true)
  })

  const create = (over: Record<string, unknown>) => {
    const b = base()
    return Material.create({
      id: b.id,
      companyId: b.companyId,
      categoryId: b.categoryId,
      brandId: b.brandId,
      sku: b.sku,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      description: b.description,
      baseUom: b.baseUom,
      defaultCost: b.defaultCost,
      currency: b.currency,
      spec: b.spec,
      wasteFactor: b.wasteFactor,
      knowledgeCode: b.knowledgeCode,
      ...over,
    })
  }

  it('rejects a SKU with spaces', () => {
    const result = create({ sku: 'POR 60' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_SKU_INVALID')
  })

  it('requires both language names', () => {
    const result = create({ nameAr: '   ' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_NAME_REQUIRED')
  })

  /** A price without a currency is a number nobody can total. */
  it('rejects a cost with no currency', () => {
    const result = create({ defaultCost: '55.0000', currency: null })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_COST_CURRENCY_MISMATCH')
  })

  it('rejects a currency with no cost', () => {
    const result = create({ defaultCost: null, currency: 'SAR' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_COST_CURRENCY_MISMATCH')
  })

  it('allows a material with neither cost nor currency', () => {
    expect(create({ defaultCost: null, currency: null }).isOk()).toBe(true)
  })

  it('rejects a waste factor above 100%', () => {
    const result = create({ wasteFactor: '150' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_WASTE_OUT_OF_RANGE')
  })
})

describe('conversions', () => {
  it('rejects a conversion that does not target the base unit', () => {
    // Chained conversions would need a graph walk at read time and would
    // compound rounding at every hop.
    const result = material().setConversion({ fromUom: 'box', toUom: 'pcs', factor: '4' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_CONVERSION_NOT_TO_BASE')
  })

  it('rejects a self-conversion', () => {
    const result = material().setConversion({ fromUom: 'm2', toUom: 'm2', factor: '1' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_CONVERSION_IDENTITY')
  })

  it('rejects a zero or negative factor', () => {
    for (const factor of ['0', '0.000000']) {
      const result = material().setConversion({ fromUom: 'box', toUom: 'm2', factor })
      expect(result.isErr(), factor).toBe(true)
      if (result.isErr()) expect(result.error.code).toBe('MATERIAL_CONVERSION_FACTOR_INVALID')
    }
  })

  it('replaces rather than duplicates an existing unit pair', () => {
    const m = material()
    expect(m.setConversion({ fromUom: 'box', toUom: 'm2', factor: '1.50' }).isOk()).toBe(true)
    expect(m.conversions).toHaveLength(1)
    expect(m.conversions[0]?.factor).toBe('1.50')
  })

  it('removes a conversion', () => {
    const m = material()
    m.removeConversion('box', 'm2')
    expect(m.conversions).toHaveLength(0)
  })
})

describe('toBaseQuantity', () => {
  it('passes a quantity already in the base unit straight through', () => {
    const result = material().toBaseQuantity(qty('12.5', 'm2'))
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.toDecimal()).toBe('12.5000')
  })

  it('applies the material-specific factor', () => {
    // 10 boxes × 1.44 m² = 14.40 m², not 10.
    const result = material().toBaseQuantity(qty('10', 'box'))
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.toDecimal()).toBe('14.4000')
      expect(result.value.uom).toBe('m2')
    }
  })

  /**
   * The failure this whole design exists to prevent. Assuming a factor of 1
   * would report 10 boxes as 10 m² and under-order a floor by ~30%.
   */
  it('errors rather than assuming a factor for an unknown pairing', () => {
    const result = material().toBaseQuantity(qty('10', 'pcs'))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_CONVERSION_MISSING')
  })

  it('uses a different factor for a different material', () => {
    // A box of 30x30 covers 0.99 m². Same unit pair, different material.
    const small = material({
      sku: 'POR-30',
      conversions: [{ fromUom: 'box', toUom: 'm2', factor: '0.99' }],
    })
    const result = small.toBaseQuantity(qty('10', 'box'))
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.toDecimal()).toBe('9.9000')
  })
})

describe('purchaseQuantity', () => {
  it('falls back to the category default when the material has no factor', () => {
    const result = material({ wasteFactor: null }).purchaseQuantity(qty('100', 'm2'), '10')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.toDecimal()).toBe('110.0000')
  })

  it("prefers the material's own factor over the category default", () => {
    // Large-format porcelain wastes more than the flooring category average;
    // overriding it is the entire reason the column exists.
    const result = material({ wasteFactor: '15' }).purchaseQuantity(qty('100', 'm2'), '10')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.toDecimal()).toBe('115.0000')
  })

  it('converts before applying waste, not after', () => {
    // 10 box → 14.40 m² → +10% = 15.84 m². Applying waste first would give
    // 11 box → 15.84 m² only by coincidence of a linear factor; the order is
    // fixed so the base-unit figure is always the one that is padded.
    const result = material().purchaseQuantity(qty('10', 'box'), '10')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.toDecimal()).toBe('15.8400')
      expect(result.value.uom).toBe('m2')
    }
  })

  it('propagates a missing conversion instead of silently padding', () => {
    const result = material().purchaseQuantity(qty('10', 'roll'), '10')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('MATERIAL_CONVERSION_MISSING')
  })
})

describe('lifecycle', () => {
  it('deactivates rather than deleting, and can be reactivated', () => {
    const m = material()
    m.deactivate()
    expect(m.isActive).toBe(false)
    m.reactivate()
    expect(m.isActive).toBe(true)
  })

  it('reprices only with a matching currency', () => {
    const m = material()
    expect(m.repriceTo('62.5000', 'SAR').isOk()).toBe(true)
    expect(m.defaultCost).toBe('62.5000')

    const bad = m.repriceTo('70', null)
    expect(bad.isErr()).toBe(true)
    // The rejected write must not have taken effect.
    expect(m.defaultCost).toBe('62.5000')
  })

  it('round-trips through a snapshot', () => {
    const snapshot = material().toSnapshot()
    expect(Material.restore(snapshot).toSnapshot()).toEqual(snapshot)
  })
})
