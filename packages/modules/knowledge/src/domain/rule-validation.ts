import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import { type Condition, type ConditionLeaf, parseCondition } from './rule'

/**
 * Validates a rule authored from the admin panel.
 *
 * The four checks here are the ones a business user can silently get wrong, and
 * three of them fail INVISIBLY: a rule referencing a fact that does not exist,
 * or comparing an enum to a value it can never hold, or pinned to a room its
 * conditions exclude, does not error at runtime — it simply never fires. The
 * screen shows no finding, which reads as "nothing is wrong". Seven such bugs
 * existed in the first draft of the shipped seed data, which is why this runs
 * on write rather than being left to a review step.
 *
 * Pure, so the same function guards the HTTP endpoint, an import script, and
 * the CI check over the shipped catalogue.
 */

export interface FactDefinition {
  factCode: string
  dataType: 'number' | 'string' | 'boolean' | 'enum'
  allowedValues: readonly string[] | null
}

export interface RuleDraft {
  conditions: unknown
  roomTypeCode?: string | null
}

export interface ValidationContext {
  facts: ReadonlyMap<string, FactDefinition>
  roomTypeCodes: ReadonlySet<string>
}

/** Leaf operators whose `value` must be an array. */
const ARRAY_OPERATORS: ReadonlySet<string> = new Set(['in', 'notIn'])
/** Leaf operators that only make sense between numbers. */
const ORDERED_OPERATORS: ReadonlySet<string> = new Set([
  'lessThan',
  'lessThanInclusive',
  'greaterThan',
  'greaterThanInclusive',
])

function leaves(node: Condition, out: ConditionLeaf[] = []): ConditionLeaf[] {
  if ('all' in node) {
    for (const child of node.all) leaves(child, out)
  } else if ('any' in node) {
    for (const child of node.any) leaves(child, out)
  } else if ('not' in node) {
    leaves(node.not, out)
  } else {
    out.push(node)
  }
  return out
}

/** Room codes a condition tree restricts the rule to, empty if unrestricted. */
export function targetedRoomTypes(node: Condition): string[] {
  const out: string[] = []
  for (const leaf of leaves(node)) {
    if (leaf.fact !== 'roomType') continue
    if (leaf.operator !== 'equal' && leaf.operator !== 'in') continue
    const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value]
    for (const value of values) if (typeof value === 'string') out.push(value)
  }
  return out
}

export function validateRuleDraft(
  draft: RuleDraft,
  context: ValidationContext,
): Result<Condition, DomainError> {
  const parsed = parseCondition(draft.conditions)
  if (parsed.isErr()) return parsed
  const conditions = parsed.value

  for (const leaf of leaves(conditions)) {
    const fact = context.facts.get(leaf.fact)
    if (!fact) {
      return err(
        validationError('RULE_FACT_UNKNOWN', `No such fact: "${leaf.fact}"`, { fact: leaf.fact }),
      )
    }

    const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value]

    if (fact.dataType === 'enum' && fact.allowedValues) {
      for (const value of values) {
        if (typeof value === 'string' && !fact.allowedValues.includes(value)) {
          return err(
            validationError(
              'RULE_ENUM_VALUE_INVALID',
              `"${value}" is not an allowed value for ${leaf.fact}`,
              { fact: leaf.fact, value, allowed: fact.allowedValues.join(', ') },
            ),
          )
        }
      }
    }

    // A number fact compared to a string silently fails every evaluation: the
    // evaluator refuses ordered comparisons between mismatched types rather
    // than coercing, so the rule would never fire and never complain.
    if (ORDERED_OPERATORS.has(leaf.operator)) {
      if (fact.dataType !== 'number') {
        return err(
          validationError(
            'RULE_OPERATOR_NOT_ORDERABLE',
            `${leaf.fact} is ${fact.dataType}; "${leaf.operator}" needs a number fact`,
            { fact: leaf.fact, operator: leaf.operator },
          ),
        )
      }
      if (values.some((value) => typeof value !== 'number')) {
        return err(
          validationError(
            'RULE_VALUE_NOT_NUMERIC',
            `"${leaf.operator}" on ${leaf.fact} needs a numeric value`,
            { fact: leaf.fact, operator: leaf.operator },
          ),
        )
      }
    }

    if (fact.dataType === 'boolean' && !ARRAY_OPERATORS.has(leaf.operator)) {
      if (values.some((value) => typeof value !== 'boolean')) {
        return err(
          validationError(
            'RULE_VALUE_NOT_BOOLEAN',
            `${leaf.fact} is a boolean fact and needs true or false`,
            { fact: leaf.fact },
          ),
        )
      }
    }
  }

  // The pre-filter must agree with the rule's own roomType condition. If it
  // disagrees the engine skips the rule before evaluating it, and if it is
  // narrower than the conditions it silently drops the other rooms — the
  // failure mode that is hardest to notice, because nothing is reported.
  const pinned = draft.roomTypeCode
  if (pinned) {
    if (!context.roomTypeCodes.has(pinned)) {
      return err(
        validationError('RULE_ROOM_TYPE_UNKNOWN', `No such room type: "${pinned}"`, {
          roomTypeCode: pinned,
        }),
      )
    }
    const targeted = targetedRoomTypes(conditions)
    if (targeted.length > 0 && !targeted.includes(pinned)) {
      return err(
        validationError(
          'RULE_FILTER_CONTRADICTS_CONDITION',
          `Room filter "${pinned}" contradicts the conditions, which match ${targeted.join(', ')}. The rule could never fire.`,
          { roomTypeCode: pinned, targeted: targeted.join(', ') },
        ),
      )
    }
    if (targeted.length > 1) {
      return err(
        validationError(
          'RULE_FILTER_TOO_NARROW',
          `Conditions match ${targeted.join(', ')} but the room filter pins the rule to "${pinned}". Clear the filter.`,
          { roomTypeCode: pinned, targeted: targeted.join(', ') },
        ),
      )
    }
  }

  return ok(conditions)
}
