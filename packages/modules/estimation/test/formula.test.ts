import { describe, expect, it } from 'vitest'
import { evaluateAst, identifiersOf, parseFormula } from '../src/domain/formula'

/**
 * The evaluator is what makes a BOQ defensible, so it is tested the way a
 * calculator is tested: precedence, parentheses, functions, and every way a
 * formula can be wrong — each refused with a code the author can act on.
 */

const evaluate = (source: string, inputs: Record<string, number> = {}) => {
  const ast = parseFormula(source)
  if (ast.isErr()) throw new Error(`parse failed: ${ast.error.message}`)
  return evaluateAst(ast.value, inputs)
}

const value = (source: string, inputs: Record<string, number> = {}): number => {
  const result = evaluate(source, inputs)
  if (result.isErr()) throw new Error(result.error.message)
  return result.value.value
}

describe('arithmetic', () => {
  it('respects precedence and parentheses', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('10 - 4 - 3')).toBe(3) // left-associative
    expect(value('12 / 4 / 3')).toBe(1)
    expect(value('2 * (3 + 4) / 7')).toBe(2)
  })

  it('handles unary minus', () => {
    expect(value('-3 + 5')).toBe(2)
    expect(value('2 * -3')).toBe(-6)
  })

  it('reads variables and decimals', () => {
    expect(value('area_m2 * 1.5', { area_m2: 10 })).toBe(15)
    expect(value('0.5 + 0.25')).toBe(0.75)
  })

  it('evaluates the shipped grout formula — the busiest one in the catalogue', () => {
    // 1.6 * ((60+60)/(60*60)) * 3 * 10 * 43.7 = 69.92
    const result = value(
      '1.6 * ((tile_w_cm + tile_h_cm) / (tile_w_cm * tile_h_cm)) * joint_mm * thickness_mm * area_m2',
      { tile_w_cm: 60, tile_h_cm: 60, joint_mm: 3, thickness_mm: 10, area_m2: 43.7 },
    )
    expect(result).toBeCloseTo(69.92, 10)
  })
})

describe('functions', () => {
  it('ceil — sheets and sacks are bought whole', () => {
    expect(value('ceil(area_m2 / 1.2)', { area_m2: 10 })).toBe(9)
    expect(
      value('ceil(area_m2 / ((tile_w_cm/100) * (tile_h_cm/100)))', {
        area_m2: 43.7,
        tile_w_cm: 60,
        tile_h_cm: 60,
      }),
    ).toBe(122)
  })

  it('supports the closed companion set', () => {
    expect(value('floor(2.9)')).toBe(2)
    expect(value('round(2.5)')).toBe(3)
    expect(value('abs(-4)')).toBe(4)
    expect(value('min(3, 7)')).toBe(3)
    expect(value('max(3, 7, 5)')).toBe(7)
  })

  it('rejects an unknown function at parse time, not in a BOQ run', () => {
    const result = parseFormula('sqrt(area_m2)')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('FORMULA_UNKNOWN_FUNCTION')
  })

  it('rejects wrong arity', () => {
    const result = parseFormula('ceil(1, 2)')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('FORMULA_ARITY')

    const single = parseFormula('min(1)')
    expect(single.isErr()).toBe(true)
    if (single.isErr()) expect(single.error.code).toBe('FORMULA_ARITY')
  })
})

describe('refusals', () => {
  it.each([
    ['1 +', 'dangling operator'],
    ['(1 + 2', 'unbalanced parenthesis'],
    ['1 ** 2', 'double operator'],
    ['area_m2 area_m2', 'two expressions'],
    ['1.', 'dangling decimal point'],
    ['a = b', 'assignment is not arithmetic'],
    ['a[0]', 'no indexing'],
    ['', 'empty'],
  ])('refuses %s (%s)', (source) => {
    expect(parseFormula(source).isErr()).toBe(true)
  })

  it('names the missing variable', () => {
    const result = evaluate('area_m2 * coats', { area_m2: 10 })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('FORMULA_INPUT_MISSING')
      expect(result.error.message).toContain('coats')
    }
  })

  it('refuses division by zero', () => {
    const result = evaluate('area_m2 / coverage', { area_m2: 10, coverage: 0 })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('FORMULA_DIVISION_BY_ZERO')
  })

  it('caps runaway nesting', () => {
    const result = parseFormula(`${'('.repeat(30)}1${')'.repeat(30)}`)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('FORMULA_TOO_DEEP')
  })
})

describe('the defensibility string', () => {
  it('substitutes every variable with name(value)', () => {
    const result = evaluate('perimeter_m * height_m - openings_m2', {
      perimeter_m: 24,
      height_m: 3,
      openings_m2: 4.2,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.substituted).toBe('perimeter_m(24) * height_m(3) - openings_m2(4.2)')
    }
  })

  it('keeps parentheses where the arithmetic needs them — the printed line must not lie', () => {
    const result = evaluate('(a + b) * c - (d - e)', { a: 1, b: 2, c: 3, d: 4, e: 5 })
    if (result.isErr()) throw new Error(result.error.message)
    expect(result.value.substituted).toBe('(a(1) + b(2)) * c(3) - (d(4) - e(5))')
    expect(result.value.value).toBe(10)
  })

  it('renders calls with their arguments', () => {
    const result = evaluate('ceil(area_m2 / 1.2)', { area_m2: 10 })
    if (result.isErr()) throw new Error(result.error.message)
    expect(result.value.substituted).toBe('ceil(area_m2(10) / 1.2)')
  })
})

describe('identifiersOf', () => {
  it('collects every variable exactly once', () => {
    const ast = parseFormula('a * (b + a) - ceil(c / a)')
    if (ast.isErr()) throw new Error(ast.error.message)
    expect([...identifiersOf(ast.value)].sort()).toEqual(['a', 'b', 'c'])
  })
})
