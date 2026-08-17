/**
 * Reference rule evaluator.
 *
 * WHY NOT json-rules-engine: the condition format is deliberately compatible
 * with it, but that library resolves facts asynchronously and throws on an
 * unknown fact. Here an absent fact must SKIP the rule, not fail the request —
 * a room where the user has not yet drawn sockets simply has no socketCount,
 * and reporting "insufficient outlets" for it would be noise. Skipped rules are
 * returned so the UI can say "add socket data to unlock 12 more checks".
 *
 * Swap in json-rules-engine later if the condition language grows; the stored
 * JSON needs no migration.
 */

const OPERATORS = {
  equal: (a, b) => a === b,
  notEqual: (a, b) => a !== b,
  lessThan: (a, b) => a < b,
  lessThanInclusive: (a, b) => a <= b,
  greaterThan: (a, b) => a > b,
  greaterThanInclusive: (a, b) => a >= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  notIn: (a, b) => Array.isArray(b) && !b.includes(a),
  contains: (a, b) => Array.isArray(a) && a.includes(b),
}

/** Sentinel distinguishing "fact absent" from a legitimate false/0/null value. */
const ABSENT = Symbol('absent')

class MissingFactError extends Error {
  constructor(fact) {
    super(`missing fact: ${fact}`)
    this.fact = fact
  }
}

function resolve(facts, leaf) {
  if (!(leaf.fact in facts)) return ABSENT
  const value = facts[leaf.fact]
  if (value === undefined) return ABSENT
  if (!leaf.path) return value
  // Minimal JSONPath: '$.a.b' only. Anything richer belongs in a real library.
  return leaf.path
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? acc : acc[key]), value)
}

/**
 * Evaluates one condition node.
 *
 * `all` short-circuits on the first false WITHOUT touching later branches, so a
 * rule gated on `roomType=kitchen` never reports a missing kitchen-only fact
 * when evaluated against a bedroom. Ordering conditions cheapest-and-most-
 * selective first is therefore load-bearing, not cosmetic.
 */
function evaluateNode(node, facts) {
  if (node.all) {
    for (const child of node.all) {
      if (!evaluateNode(child, facts)) return false
    }
    return true
  }
  if (node.any) {
    let missing = null
    for (const child of node.any) {
      try {
        if (evaluateNode(child, facts)) return true
      } catch (error) {
        if (error instanceof MissingFactError) missing ??= error
        else throw error
      }
    }
    // A branch is only inconclusive if nothing else in it matched.
    if (missing) throw missing
    return false
  }
  if (node.not) return !evaluateNode(node.not, facts)

  const operator = OPERATORS[node.operator]
  if (!operator) throw new Error(`unknown operator: ${node.operator}`)

  const actual = resolve(facts, node)
  if (actual === ABSENT) throw new MissingFactError(node.fact)
  return operator(actual, node.value)
}

const SEVERITY_ORDER = { critical: 0, error: 1, warning: 2, info: 3, suggestion: 4 }

/**
 * @param {Array} rules  rows from kb_rules (conditions may be string or object)
 * @param {Object} facts fact_code -> value
 * @param {{domains?: string[], ruleTypes?: string[], roomId?: string}} options
 */
export function evaluate(rules, facts, options = {}) {
  const started = performance.now()
  const findings = []
  const skipped = []

  for (const rule of rules) {
    if (rule.is_active === 0 || rule.is_active === false) continue
    if (options.domains?.length && !options.domains.includes(rule.domain)) continue
    if (options.ruleTypes?.length && !options.ruleTypes.includes(rule.rule_type)) continue
    // room_type_code is a pre-filter that lets the engine skip most rules
    // without walking their condition trees. It is verified to agree with the
    // rule's own roomType condition, so applying it changes no outcome.
    if (rule.room_type_code && facts.roomType && rule.room_type_code !== facts.roomType) continue

    const conditions =
      typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions

    let matched
    try {
      matched = evaluateNode(conditions, facts)
    } catch (error) {
      if (error instanceof MissingFactError) {
        skipped.push({ code: rule.code, missingFact: error.fact })
        continue
      }
      throw error
    }
    if (!matched) continue

    const action = typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action
    findings.push({
      code: rule.code,
      ruleType: rule.rule_type,
      domain: rule.domain,
      severity: rule.severity,
      message: { en: rule.message_en, ar: rule.message_ar },
      action: action ?? null,
      priority: rule.priority ?? 100,
      roomId: options.roomId ?? null,
    })
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.priority - b.priority ||
      a.code.localeCompare(b.code),
  )

  return {
    findings,
    evaluated: {
      ruleCount: rules.length,
      durationMs: Number((performance.now() - started).toFixed(3)),
      skipped,
    },
  }
}

/**
 * Applies an estimation formula.
 *
 * The formula language is deliberately tiny: arithmetic over the declared input
 * variables plus a handful of math functions. It is compiled with `Function`
 * over an explicit allow-list of identifiers — every token in the expression
 * must be a declared input or a whitelisted function, checked before compiling,
 * so a formula edited by a business user in the admin panel cannot reach
 * `process`, `fetch`, or anything else in scope.
 */
const FORMULA_FUNCTIONS = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  sqrt: Math.sqrt,
  pow: Math.pow,
}

export function estimate(standard, values) {
  const inputs = typeof standard.inputs === 'string' ? JSON.parse(standard.inputs) : standard.inputs
  const declared = new Set(inputs.map((i) => i.var))

  for (const token of standard.formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (!declared.has(token) && !(token in FORMULA_FUNCTIONS)) {
      throw new Error(`formula ${standard.code} references undeclared identifier "${token}"`)
    }
  }
  for (const input of inputs) {
    if (typeof values[input.var] !== 'number' || Number.isNaN(values[input.var])) {
      throw new Error(`estimate ${standard.code}: input "${input.var}" must be a number`)
    }
  }

  const names = [...declared, ...Object.keys(FORMULA_FUNCTIONS)]
  const args = [
    ...[...declared].map((name) => values[name]),
    ...Object.values(FORMULA_FUNCTIONS),
  ]
  // Identifiers are allow-listed above, so the expression cannot name anything
  // outside `declared` + FORMULA_FUNCTIONS — no `process`, no `fetch`.
  const compute = new Function(...names, `"use strict"; return (${standard.formula});`)
  const base = compute(...args)

  if (typeof base !== 'number' || !Number.isFinite(base)) {
    throw new Error(`estimate ${standard.code} produced a non-finite result`)
  }

  const wastePct = Number(standard.waste_pct ?? 0)
  const withWaste = base * (1 + wastePct / 100)

  return {
    code: standard.code,
    unit: standard.output_unit,
    base: Number(base.toFixed(4)),
    wastePct,
    // Piece counts cannot be fractional; area/volume/length stay precise.
    quantity: ['pc', 'bag'].includes(standard.output_unit)
      ? Math.ceil(withWaste)
      : Number(withWaste.toFixed(4)),
  }
}
