import { describe, expect, it } from 'vitest'
import {
  type FactDefinition,
  type ValidationContext,
  targetedRoomTypes,
  validateRuleDraft,
} from '../src/domain/rule-validation'
import { parseCondition } from '../src/domain/rule'

/**
 * These checks exist because three of the four failures they catch are
 * INVISIBLE at runtime: the rule simply never fires, the review screen reports
 * nothing, and "nothing found" reads as "nothing wrong". Seven such bugs were
 * present in the first draft of the shipped seed data.
 */

const fact = (
  factCode: string,
  dataType: FactDefinition['dataType'],
  allowedValues: string[] | null = null,
): FactDefinition => ({ factCode, dataType, allowedValues })

const context: ValidationContext = {
  facts: new Map(
    [
      fact('roomType', 'enum', ['bathroom', 'kitchen', 'master_bedroom', 'majlis']),
      fact('area', 'number'),
      fact('socketCount', 'number'),
      fact('isWetArea', 'boolean'),
      fact('hasRcd', 'boolean'),
      fact('finishLevel', 'enum', ['economy', 'standard', 'premium', 'luxury']),
    ].map((f) => [f.factCode, f]),
  ),
  roomTypeCodes: new Set(['bathroom', 'kitchen', 'master_bedroom', 'majlis']),
}

const draft = (conditions: unknown, roomTypeCode: string | null = null) =>
  validateRuleDraft({ conditions, roomTypeCode }, context)

describe('validateRuleDraft', () => {
  it('accepts a well-formed rule', () => {
    const result = draft({
      all: [
        { fact: 'roomType', operator: 'equal', value: 'bathroom' },
        { fact: 'socketCount', operator: 'lessThan', value: 4 },
      ],
    })
    expect(result.isOk()).toBe(true)
  })

  it('rejects a fact that does not exist', () => {
    const result = draft({ all: [{ fact: 'sockeCount', operator: 'lessThan', value: 4 }] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_FACT_UNKNOWN')
  })

  it('rejects an enum value the fact can never hold', () => {
    // A typo here yields a rule that evaluates false forever and reports nothing.
    const result = draft({ all: [{ fact: 'roomType', operator: 'equal', value: 'bathrom' }] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_ENUM_VALUE_INVALID')
  })

  it('checks every value of an in-list, not just the first', () => {
    const result = draft({
      all: [{ fact: 'roomType', operator: 'in', value: ['bathroom', 'kitchn'] }],
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_ENUM_VALUE_INVALID')
  })

  it('rejects an ordered comparison on a non-numeric fact', () => {
    // The evaluator refuses to coerce, so this would silently never match.
    const result = draft({ all: [{ fact: 'roomType', operator: 'greaterThan', value: 3 }] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_OPERATOR_NOT_ORDERABLE')
  })

  it('rejects a numeric comparison against a string value', () => {
    const result = draft({ all: [{ fact: 'area', operator: 'greaterThan', value: '20' }] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_VALUE_NOT_NUMERIC')
  })

  it('rejects a boolean fact compared to a string', () => {
    const result = draft({ all: [{ fact: 'hasRcd', operator: 'equal', value: 'false' }] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_VALUE_NOT_BOOLEAN')
  })

  it('rejects an unknown operator', () => {
    const result = draft({ all: [{ fact: 'area', operator: 'roughly', value: 20 }] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_OPERATOR_UNKNOWN')
  })

  it('validates nested branches, not just the top level', () => {
    const result = draft({
      all: [
        { fact: 'isWetArea', operator: 'equal', value: true },
        { any: [{ fact: 'nope', operator: 'equal', value: 1 }] },
      ],
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_FACT_UNKNOWN')
  })

  it('rejects an unknown room filter', () => {
    const result = draft({ all: [{ fact: 'area', operator: 'greaterThan', value: 5 }] }, 'sauna')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_ROOM_TYPE_UNKNOWN')
  })

  /** The worst failure mode: the rule can never fire and never complains. */
  it('rejects a room filter that contradicts the conditions', () => {
    const result = draft(
      { all: [{ fact: 'roomType', operator: 'equal', value: 'kitchen' }] },
      'bathroom',
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_FILTER_CONTRADICTS_CONDITION')
  })

  it('rejects a room filter narrower than the conditions', () => {
    // Pinning to one room silently drops the others the rule was written for.
    const result = draft(
      { all: [{ fact: 'roomType', operator: 'in', value: ['bathroom', 'kitchen'] }] },
      'bathroom',
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RULE_FILTER_TOO_NARROW')
  })

  it('accepts a room filter that agrees with the conditions', () => {
    const result = draft(
      { all: [{ fact: 'roomType', operator: 'equal', value: 'bathroom' }] },
      'bathroom',
    )
    expect(result.isOk()).toBe(true)
  })

  it('accepts a room filter on a rule with no roomType condition', () => {
    const result = draft(
      { all: [{ fact: 'isWetArea', operator: 'equal', value: true }] },
      'kitchen',
    )
    expect(result.isOk()).toBe(true)
  })

  it('allows in/notIn on a boolean fact without demanding a boolean scalar', () => {
    const result = draft({ all: [{ fact: 'hasRcd', operator: 'in', value: [true, false] }] })
    expect(result.isOk()).toBe(true)
  })
})

describe('targetedRoomTypes', () => {
  it('collects rooms from equal and in conditions', () => {
    const parsed = parseCondition({
      all: [
        { fact: 'roomType', operator: 'in', value: ['bathroom', 'kitchen'] },
        { fact: 'area', operator: 'greaterThan', value: 4 },
      ],
    })
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk()) expect(targetedRoomTypes(parsed.value)).toEqual(['bathroom', 'kitchen'])
  })

  it('ignores notIn, which restricts nothing positively', () => {
    const parsed = parseCondition({
      all: [{ fact: 'roomType', operator: 'notIn', value: ['storage'] }],
    })
    expect(parsed.isOk()).toBe(true)
    if (parsed.isOk()) expect(targetedRoomTypes(parsed.value)).toEqual([])
  })
})
