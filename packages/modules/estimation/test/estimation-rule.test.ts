import { describe, expect, it } from 'vitest'
import {
  evaluateRule,
  parseRuleInputs,
  validateOverride,
  type EstimationRule,
} from '../src/domain/estimation-rule'

/**
 * The rule layer over the evaluator: waste uplift per the engine contract
 * (result × (1 + waste/100)), write-time override validation, and the
 * refusals that keep a BOQ line honest.
 */

const PAINT: EstimationRule = {
  code: 'est_paint_quantity',
  nameEn: 'Paint Quantity (per coat)',
  nameAr: 'كمية الدهان (للوجه)',
  trade: 'painting',
  outputUnit: 'L',
  inputs: [
    { var: 'area_m2', labelEn: 'Paintable area', unit: 'm2' },
    { var: 'coats', labelEn: 'Number of coats', unit: 'count' },
    { var: 'coverage_m2_per_l', labelEn: 'Coverage rate', unit: 'm2/L' },
  ],
  formula: 'area_m2 * coats / coverage_m2_per_l',
  wastePct: '10.00',
  notesEn: null,
  isActive: true,
  isOverride: false,
}

describe('evaluateRule', () => {
  it('applies the waste contract: quantityWithWaste = result × (1 + waste/100)', () => {
    const result = evaluateRule(PAINT, { area_m2: '43.7', coats: '2', coverage_m2_per_l: '10' })
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value.quantity).toBe('8.7400')
    expect(result.value.quantityWithWaste).toBe('9.6140')
    expect(result.value.outputUnit).toBe('L')
    expect(result.value.formulaEvaluated).toBe(
      'area_m2(43.7) * coats(2) / coverage_m2_per_l(10) = 8.7400',
    )
    expect(result.value.inputs).toEqual({ area_m2: '43.7', coats: '2', coverage_m2_per_l: '10' })
  })

  it('refuses a disabled rule', () => {
    const result = evaluateRule({ ...PAINT, isActive: false }, {})
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_DISABLED')
  })

  it('refuses a negative take-off — openings larger than the wall is a data error', () => {
    const wallArea: EstimationRule = {
      ...PAINT,
      code: 'est_paint_wall_area',
      formula: 'perimeter_m * height_m - openings_m2',
      wastePct: '0.00',
      inputs: [
        { var: 'perimeter_m', labelEn: 'Perimeter', unit: 'm' },
        { var: 'height_m', labelEn: 'Height', unit: 'm' },
        { var: 'openings_m2', labelEn: 'Openings', unit: 'm2' },
      ],
    }
    const result = evaluateRule(wallArea, { perimeter_m: '4', height_m: '3', openings_m2: '50' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('FORMULA_RESULT_NEGATIVE')
  })

  it('refuses a malformed input value with the variable named', () => {
    const result = evaluateRule(PAINT, { area_m2: 'ten', coats: '2', coverage_m2_per_l: '10' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('FORMULA_INPUT_INVALID')
      expect(result.error.message).toContain('area_m2')
    }
  })

  it('reports what is actually missing, not what was merely not sent', () => {
    const result = evaluateRule(PAINT, { area_m2: '43.7', coats: '2' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('FORMULA_INPUT_MISSING')
      expect(result.error.message).toContain('coverage_m2_per_l')
    }
  })
})

describe('validateOverride', () => {
  it('accepts a formula over the declared inputs', () => {
    expect(validateOverride('area_m2 * coats / 12', PAINT.inputs).isOk()).toBe(true)
  })

  it('refuses an undeclared variable at write time, in front of its author', () => {
    const result = validateOverride('area_m2 * secret_factor', PAINT.inputs)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('FORMULA_UNDECLARED_VARIABLE')
      expect(result.error.message).toContain('secret_factor')
    }
  })

  it('refuses a formula that does not parse', () => {
    expect(validateOverride('area_m2 *', PAINT.inputs).isErr()).toBe(true)
  })

  it('refuses a malformed waste percentage', () => {
    const result = validateOverride('area_m2', PAINT.inputs, '10.555')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('WASTE_PCT_INVALID')
  })
})

describe('parseRuleInputs', () => {
  it('reads the catalogue shape and tolerates junk rows', () => {
    const inputs = parseRuleInputs([
      { var: 'area_m2', label_en: 'Area', unit: 'm2' },
      { notVar: true },
      'garbage',
      { var: 'coats' },
    ])
    expect(inputs).toEqual([
      { var: 'area_m2', labelEn: 'Area', unit: 'm2' },
      { var: 'coats', labelEn: 'coats', unit: '' },
    ])
  })

  it('returns empty for non-arrays rather than throwing', () => {
    expect(parseRuleInputs('not json')).toEqual([])
    expect(parseRuleInputs(null)).toEqual([])
  })
})
