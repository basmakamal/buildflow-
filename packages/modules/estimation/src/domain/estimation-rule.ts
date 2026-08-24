import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import { evaluateAst, identifiersOf, parseFormula } from './formula'

/**
 * Estimation rules — the declarative take-off catalogue. docs/02 §3.7
 *
 * A rule is DATA, not code: a formula over declared inputs, a waste factor,
 * and an output unit. The shipped catalogue comes from the knowledge base;
 * a tenant override is a complete replacement row for one code, merged here
 * with "tenant wins". The engine's contract (documented with the table):
 * quantityWithWaste = formula result × (1 + wastePct/100).
 *
 * Waste is a COLUMN, not a constant in code, because it is the single
 * most-adjusted value per company — that is what makes overrides the point
 * of this sprint rather than an afterthought.
 */

export interface RuleInput {
  var: string
  labelEn: string
  unit: string
}

export interface EstimationRule {
  code: string
  nameEn: string
  nameAr: string
  trade: string
  outputUnit: string
  inputs: readonly RuleInput[]
  formula: string
  /** Percentage, 2 dp string — "10.00" adds ten percent. */
  wastePct: string
  notesEn: string | null
  isActive: boolean
  /** True when the tenant's replacement row is in force, not the shipped one. */
  isOverride: boolean
}

const INPUT_PATTERN = /^-?\d{1,10}(\.\d{1,4})?$/
const WASTE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/

/** Parses the raw `inputs` JSON — rows authored in SQL, so verified, not trusted. */
export function parseRuleInputs(raw: unknown): readonly RuleInput[] {
  if (!Array.isArray(raw)) return []
  const inputs: RuleInput[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as {
      var?: unknown
      label_en?: unknown
      labelEn?: unknown
      unit?: unknown
    }
    if (typeof candidate.var !== 'string') continue
    inputs.push({
      var: candidate.var,
      labelEn:
        typeof candidate.label_en === 'string'
          ? candidate.label_en
          : typeof candidate.labelEn === 'string'
            ? candidate.labelEn
            : candidate.var,
      unit: typeof candidate.unit === 'string' ? candidate.unit : '',
    })
  }
  return inputs
}

/**
 * Validates a tenant's replacement formula against the rule's DECLARED inputs.
 * A formula referencing a variable nobody declared would not fail here and
 * now, in front of its author — it would fail during a BOQ run months later,
 * for whoever happens to generate one. Refusing it at write time is the gift.
 */
export function validateOverride(
  formula: string,
  declaredInputs: readonly RuleInput[],
  wastePct?: string,
): Result<void, DomainError> {
  if (wastePct !== undefined && !WASTE_PATTERN.test(wastePct)) {
    return err(
      validationError('WASTE_PCT_INVALID', 'Waste is a percentage, 0–999.99, at most 2 dp', {
        wastePct,
      }),
    )
  }
  const ast = parseFormula(formula)
  if (ast.isErr()) return err(ast.error)

  const declared = new Set(declaredInputs.map((input) => input.var))
  for (const name of identifiersOf(ast.value)) {
    if (!declared.has(name)) {
      return err(
        validationError(
          'FORMULA_UNDECLARED_VARIABLE',
          `"${name}" is not one of this rule's declared inputs`,
          { variable: name, declared: [...declared].join(', ') },
        ),
      )
    }
  }
  return ok(undefined)
}

export interface RuleEvaluation {
  code: string
  outputUnit: string
  /** 4 dp — the raw take-off before waste. */
  quantity: string
  wastePct: string
  /** 4 dp — quantity × (1 + wastePct/100), the number the BOQ line carries. */
  quantityWithWaste: string
  /** `area_m2(43.7) * coats(2) = 87.4` — the defensibility string. docs/04 §2.7 */
  formulaEvaluated: string
  /** Echo of the inputs used, for the BOQ line's formula_inputs JSON. */
  inputs: Record<string, string>
}

/** Half-away-from-zero at 4 dp — the same rounding Quantity and Money use. */
const round4 = (value: number): string => {
  const scaled = Math.round(Math.abs(value) * 10_000) / 10_000
  return (value < 0 ? -scaled : scaled).toFixed(4)
}

export function evaluateRule(
  rule: EstimationRule,
  rawInputs: Readonly<Record<string, string>>,
): Result<RuleEvaluation, DomainError> {
  if (!rule.isActive) {
    return err(
      validationError('RULE_DISABLED', `Rule ${rule.code} is disabled for this company`, {
        code: rule.code,
      }),
    )
  }

  const numeric: Record<string, number> = {}
  const echoed: Record<string, string> = {}
  for (const input of rule.inputs) {
    const value = rawInputs[input.var]
    if (value === undefined) continue // the evaluator reports what is truly needed
    if (!INPUT_PATTERN.test(value)) {
      return err(
        validationError('FORMULA_INPUT_INVALID', `"${input.var}" must be a decimal, at most 4 dp`, {
          variable: input.var,
          value,
        }),
      )
    }
    numeric[input.var] = Number(value)
    echoed[input.var] = value
  }

  const ast = parseFormula(rule.formula)
  if (ast.isErr()) return err(ast.error)

  const evaluated = evaluateAst(ast.value, numeric)
  if (evaluated.isErr()) return err(evaluated.error)

  // A negative take-off is not a quantity anyone can buy — it is a data-entry
  // error (openings larger than the wall) to refuse now, not to price later.
  if (evaluated.value.value < 0) {
    return err(
      validationError('FORMULA_RESULT_NEGATIVE', 'The formula produced a negative quantity', {
        result: evaluated.value.value,
      }),
    )
  }

  const quantity = round4(evaluated.value.value)
  const withWaste = round4(evaluated.value.value * (1 + Number(rule.wastePct) / 100))

  return ok({
    code: rule.code,
    outputUnit: rule.outputUnit,
    quantity,
    wastePct: rule.wastePct,
    quantityWithWaste: withWaste,
    formulaEvaluated: `${evaluated.value.substituted} = ${quantity}`,
    inputs: echoed,
  })
}
