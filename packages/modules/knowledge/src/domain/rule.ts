import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'

/**
 * Rule evaluation — the pure core of the AI engine.
 *
 * WHY A HAND-WRITTEN EVALUATOR: the stored condition format is deliberately
 * json-rules-engine compatible, but that library resolves facts asynchronously
 * and throws on an unknown fact. Here an absent fact must SKIP the rule, not
 * fail the request — a room where nobody has drawn sockets yet has no
 * socketCount, and reporting "insufficient outlets" for it is a lie dressed as
 * a warning. That distinction is the whole design, and it is not configurable
 * in the library. Swapping the library in later needs no data migration.
 *
 * Everything here is pure: no clock, no I/O, no ambient state. Timing and
 * persistence belong to the application layer.
 */

export const RULE_TYPES = ['recommendation', 'validation'] as const
export type RuleType = (typeof RULE_TYPES)[number]

export const RULE_DOMAINS = [
  'lighting',
  'electrical',
  'plumbing',
  'furniture',
  'finishing',
  'progress',
  'estimation',
  'general',
] as const
export type RuleDomain = (typeof RULE_DOMAINS)[number]

export const SEVERITIES = ['suggestion', 'info', 'warning', 'error', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

/** Ascending = more urgent. Drives finding order, so the worst is read first. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  suggestion: 4,
}

export type FactValue = string | number | boolean | null
export type Facts = Readonly<Record<string, FactValue | undefined>>

export const OPERATORS = [
  'equal',
  'notEqual',
  'lessThan',
  'lessThanInclusive',
  'greaterThan',
  'greaterThanInclusive',
  'in',
  'notIn',
] as const
export type Operator = (typeof OPERATORS)[number]

const OPERATOR_SET: ReadonlySet<string> = new Set(OPERATORS)

export interface ConditionLeaf {
  fact: string
  operator: Operator
  value: FactValue | readonly FactValue[]
}

export interface ConditionAll {
  all: readonly Condition[]
}
export interface ConditionAny {
  any: readonly Condition[]
}
export interface ConditionNot {
  not: Condition
}

export type Condition = ConditionLeaf | ConditionAll | ConditionAny | ConditionNot

export interface Rule {
  code: string
  ruleType: RuleType
  domain: RuleDomain
  /** Pre-filter; must agree with any roomType condition inside `conditions`. */
  roomTypeCode: string | null
  conditions: Condition
  severity: Severity
  messageEn: string
  messageAr: string
  action: Readonly<Record<string, unknown>> | null
  priority: number
}

export interface Finding {
  code: string
  ruleType: RuleType
  domain: RuleDomain
  severity: Severity
  message: { en: string; ar: string }
  action: Readonly<Record<string, unknown>> | null
  priority: number
}

export interface SkippedRule {
  code: string
  /** The fact the rule needed and the caller did not supply. */
  missingFact: string
}

export interface EvaluationResult {
  findings: readonly Finding[]
  skipped: readonly SkippedRule[]
  /**
   * Rules that passed the domain/type/room filters and were actually run.
   *
   * Reported rather than derived: a caller computing `total - skipped` counts
   * every filtered-out rule as evaluated, which overstates coverage precisely
   * when the caller narrowed the request.
   */
  considered: number
}

export interface EvaluateOptions {
  domains?: readonly RuleDomain[]
  ruleTypes?: readonly RuleType[]
}

const isBranchAll = (c: Condition): c is ConditionAll => 'all' in c
const isBranchAny = (c: Condition): c is ConditionAny => 'any' in c
const isBranchNot = (c: Condition): c is ConditionNot => 'not' in c

/**
 * Validates a condition tree loaded from storage.
 *
 * MariaDB 10.4 stores JSON as LONGTEXT and enforces only well-formedness, and
 * business users edit these rules from an admin panel. So the shape is checked
 * here, at the boundary of the domain, rather than trusted.
 */
export function parseCondition(input: unknown): Result<Condition, DomainError> {
  if (input === null || typeof input !== 'object') {
    return err(validationError('RULE_CONDITION_MALFORMED', 'Condition must be an object'))
  }
  const node = input as Record<string, unknown>

  for (const key of ['all', 'any'] as const) {
    if (key in node) {
      const branch = node[key]
      if (!Array.isArray(branch) || branch.length === 0) {
        return err(
          validationError('RULE_CONDITION_MALFORMED', `"${key}" must be a non-empty array`),
        )
      }
      const children: Condition[] = []
      for (const child of branch) {
        const parsed = parseCondition(child)
        if (parsed.isErr()) return parsed
        children.push(parsed.value)
      }
      return ok(key === 'all' ? { all: children } : { any: children })
    }
  }

  if ('not' in node) {
    const parsed = parseCondition(node['not'])
    if (parsed.isErr()) return parsed
    return ok({ not: parsed.value })
  }

  const { fact, operator, value } = node
  if (typeof fact !== 'string' || fact.length === 0) {
    return err(validationError('RULE_CONDITION_MALFORMED', 'Leaf condition needs a fact name'))
  }
  if (typeof operator !== 'string' || !OPERATOR_SET.has(operator)) {
    return err(
      validationError('RULE_OPERATOR_UNKNOWN', `Unknown operator "${String(operator)}"`, { fact }),
    )
  }
  if ((operator === 'in' || operator === 'notIn') && !Array.isArray(value)) {
    return err(
      validationError('RULE_CONDITION_MALFORMED', `Operator "${operator}" needs an array value`, {
        fact,
      }),
    )
  }
  return ok({ fact, operator: operator as Operator, value: value as ConditionLeaf['value'] })
}

/** Thrown internally when a rule needs a fact the caller did not supply. */
class MissingFact extends Error {
  constructor(readonly factCode: string) {
    super(`missing fact: ${factCode}`)
  }
}

function compare(operator: Operator, actual: FactValue, expected: ConditionLeaf['value']): boolean {
  switch (operator) {
    case 'equal':
      return actual === expected
    case 'notEqual':
      return actual !== expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'notIn':
      return Array.isArray(expected) && !expected.includes(actual)
    default:
      break
  }
  // Ordered comparisons are only meaningful between numbers. Comparing a string
  // to a number in JS silently coerces and yields nonsense, so refuse instead.
  if (typeof actual !== 'number' || typeof expected !== 'number') return false
  switch (operator) {
    case 'lessThan':
      return actual < expected
    case 'lessThanInclusive':
      return actual <= expected
    case 'greaterThan':
      return actual > expected
    case 'greaterThanInclusive':
      return actual >= expected
    default:
      return false
  }
}

/**
 * `all` short-circuits on the first false WITHOUT evaluating later branches, so
 * a rule gated on `roomType=kitchen` never reports a missing kitchen-only fact
 * when run against a bedroom. Condition order is therefore load-bearing:
 * cheapest and most selective first.
 */
function evaluateNode(node: Condition, facts: Facts): boolean {
  if (isBranchAll(node)) {
    for (const child of node.all) {
      if (!evaluateNode(child, facts)) return false
    }
    return true
  }

  if (isBranchAny(node)) {
    let missing: MissingFact | null = null
    for (const child of node.any) {
      try {
        if (evaluateNode(child, facts)) return true
      } catch (error) {
        if (error instanceof MissingFact) missing ??= error
        else throw error
      }
    }
    // Only inconclusive if nothing else in the branch matched: one satisfied
    // alternative makes the missing fact irrelevant.
    if (missing) throw missing
    return false
  }

  if (isBranchNot(node)) return !evaluateNode(node.not, facts)

  const actual = facts[node.fact]
  if (actual === undefined) throw new MissingFact(node.fact)
  return compare(node.operator, actual, node.value)
}

/**
 * Evaluates rules against a fact set.
 *
 * Never throws for data reasons: a malformed rule is reported as skipped rather
 * than failing the whole request, because one bad rule authored in the admin
 * panel must not take down analysis for every room in the tenant.
 */
export function evaluate(
  rules: readonly Rule[],
  facts: Facts,
  options: EvaluateOptions = {},
): EvaluationResult {
  const findings: Finding[] = []
  const skipped: SkippedRule[] = []
  let considered = 0

  for (const rule of rules) {
    if (options.domains?.length && !options.domains.includes(rule.domain)) continue
    if (options.ruleTypes?.length && !options.ruleTypes.includes(rule.ruleType)) continue
    // A pre-filter only: verified to agree with the rule's own roomType
    // condition, so applying it changes no outcome, only the work done.
    const roomType = facts['roomType']
    if (rule.roomTypeCode && roomType !== undefined && rule.roomTypeCode !== roomType) continue

    considered++
    let matched: boolean
    try {
      matched = evaluateNode(rule.conditions, facts)
    } catch (error) {
      if (error instanceof MissingFact) {
        skipped.push({ code: rule.code, missingFact: error.factCode })
        continue
      }
      throw error
    }
    if (!matched) continue

    findings.push({
      code: rule.code,
      ruleType: rule.ruleType,
      domain: rule.domain,
      severity: rule.severity,
      message: { en: rule.messageEn, ar: rule.messageAr },
      action: rule.action,
      priority: rule.priority,
    })
  }

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.priority - b.priority ||
      a.code.localeCompare(b.code),
  )

  return { findings, skipped, considered }
}
