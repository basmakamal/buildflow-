import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'

/**
 * The formula evaluator — the pure core of the quantity rule engine.
 *
 * WHY HAND-WRITTEN, NOT mathjs: the stored format is deliberately
 * mathjs-compatible (kb_estimation_standards documents it that way), but
 * tenant-authored formulas are hostile input running on the server. mathjs
 * ships an entire CAS — matrices, units, arbitrary-precision bignumbers,
 * function definition — and its evaluator has a history of sandbox escapes.
 * This grammar is the six things a take-off formula actually uses:
 *
 *   number · identifier · + - * / · parentheses · a closed set of functions
 *
 * Nothing else parses. There is no assignment, no property access, no user
 * functions, and no way to reach an object — the attack surface is a
 * calculator. Swapping mathjs in later needs no data migration.
 *
 * Everything here is pure: no clock, no I/O, no ambient state.
 */

export type FormulaAst =
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string }
  | { kind: 'negate'; operand: FormulaAst }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaAst; right: FormulaAst }
  | { kind: 'call'; fn: FunctionName; args: FormulaAst[] }

/**
 * The closed function set. `ceil` is what the shipped catalogue uses (sheets,
 * tiles and sacks are bought whole); the rest are the obvious companions a
 * tenant formula may reasonably want. Adding one is a code change on purpose.
 */
export const FORMULA_FUNCTIONS = ['ceil', 'floor', 'round', 'abs', 'min', 'max'] as const
export type FunctionName = (typeof FORMULA_FUNCTIONS)[number]

const FUNCTION_SET: ReadonlySet<string> = new Set(FORMULA_FUNCTIONS)

const MAX_LENGTH = 500
const MAX_TOKENS = 200
const MAX_DEPTH = 24

interface Token {
  kind: 'number' | 'identifier' | 'op' | 'lparen' | 'rparen' | 'comma'
  text: string
  at: number
}

const invalid = (message: string, at: number): DomainError =>
  validationError('FORMULA_INVALID', `${message} (at position ${String(at)})`, { at })

function tokenize(source: string): Result<Token[], DomainError> {
  const tokens: Token[] = []
  let i = 0
  const isDigit = (at: number): boolean => source.charAt(at) >= '0' && source.charAt(at) <= '9'
  while (i < source.length) {
    const ch = source.charAt(i)
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (ch >= '0' && ch <= '9') {
      const start = i
      while (i < source.length && isDigit(i)) i += 1
      if (source.charAt(i) === '.') {
        i += 1
        const fractionStart = i
        while (i < source.length && isDigit(i)) i += 1
        if (i === fractionStart) return err(invalid('A digit must follow the decimal point', i))
      }
      tokens.push({ kind: 'number', text: source.slice(start, i), at: start })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i
      while (i < source.length && /[a-zA-Z0-9_]/.test(source.charAt(i))) i += 1
      tokens.push({ kind: 'identifier', text: source.slice(start, i), at: start })
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', text: ch, at: i })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch, at: i })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch, at: i })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', text: ch, at: i })
      i += 1
      continue
    }
    return err(invalid(`Unexpected character "${ch}"`, i))
  }
  if (tokens.length > MAX_TOKENS) {
    return err(validationError('FORMULA_TOO_COMPLEX', `At most ${String(MAX_TOKENS)} tokens`, {}))
  }
  return ok(tokens)
}

export function parseFormula(source: string): Result<FormulaAst, DomainError> {
  if (source.trim().length === 0) {
    return err(validationError('FORMULA_INVALID', 'The formula is empty', { at: 0 }))
  }
  if (source.length > MAX_LENGTH) {
    return err(validationError('FORMULA_TOO_LONG', `At most ${String(MAX_LENGTH)} characters`, {}))
  }
  const tokens = tokenize(source)
  if (tokens.isErr()) return err(tokens.error)

  let position = 0
  const peek = (): Token | undefined => tokens.value[position]
  const next = (): Token | undefined => tokens.value[position++]

  function parseExpression(depth: number): Result<FormulaAst, DomainError> {
    if (depth > MAX_DEPTH) {
      return err(
        validationError('FORMULA_TOO_DEEP', `At most ${String(MAX_DEPTH)} nesting levels`, {}),
      )
    }
    const left = parseTerm(depth)
    if (left.isErr()) return left
    let node = left.value
    for (;;) {
      const token = peek()
      if (!token || token.kind !== 'op' || (token.text !== '+' && token.text !== '-')) break
      next()
      const right = parseTerm(depth)
      if (right.isErr()) return right
      node = { kind: 'binary', op: token.text, left: node, right: right.value }
    }
    return ok(node)
  }

  function parseTerm(depth: number): Result<FormulaAst, DomainError> {
    const left = parseFactor(depth)
    if (left.isErr()) return left
    let node = left.value
    for (;;) {
      const token = peek()
      if (!token || token.kind !== 'op' || (token.text !== '*' && token.text !== '/')) break
      next()
      const right = parseFactor(depth)
      if (right.isErr()) return right
      node = { kind: 'binary', op: token.text, left: node, right: right.value }
    }
    return ok(node)
  }

  function parseFactor(depth: number): Result<FormulaAst, DomainError> {
    const token = next()
    if (!token) return err(invalid('The formula ends unexpectedly', source.length))

    if (token.kind === 'op' && token.text === '-') {
      const operand = parseFactor(depth + 1)
      if (operand.isErr()) return operand
      return ok({ kind: 'negate', operand: operand.value })
    }
    if (token.kind === 'number') {
      return ok({ kind: 'number', value: Number(token.text) })
    }
    if (token.kind === 'lparen') {
      const inner = parseExpression(depth + 1)
      if (inner.isErr()) return inner
      const closing = next()
      if (!closing || closing.kind !== 'rparen') {
        return err(invalid('Missing closing parenthesis', closing?.at ?? source.length))
      }
      return ok(inner.value)
    }
    if (token.kind === 'identifier') {
      if (peek()?.kind !== 'lparen') {
        return ok({ kind: 'variable', name: token.text })
      }
      // A call. The function set is closed — an unknown name fails at parse
      // time, where the author sees it, not at evaluation time in a BOQ run.
      next()
      if (!FUNCTION_SET.has(token.text)) {
        return err(
          validationError('FORMULA_UNKNOWN_FUNCTION', `Unknown function "${token.text}"`, {
            fn: token.text,
            allowed: FORMULA_FUNCTIONS.join(', '),
          }),
        )
      }
      const args: FormulaAst[] = []
      if (peek()?.kind === 'rparen') {
        return err(invalid(`${token.text}() needs at least one argument`, token.at))
      }
      for (;;) {
        const arg = parseExpression(depth + 1)
        if (arg.isErr()) return arg
        args.push(arg.value)
        const after = next()
        if (after?.kind === 'rparen') break
        if (after?.kind !== 'comma') {
          return err(
            invalid('Expected "," or ")" in the argument list', after?.at ?? source.length),
          )
        }
      }
      const unary =
        token.text === 'min' || token.text === 'max' ? args.length >= 2 : args.length === 1
      if (!unary) {
        return err(
          validationError(
            'FORMULA_ARITY',
            token.text === 'min' || token.text === 'max'
              ? `${token.text}() takes two or more arguments`
              : `${token.text}() takes exactly one argument`,
            { fn: token.text, received: args.length },
          ),
        )
      }
      return ok({ kind: 'call', fn: token.text as FunctionName, args })
    }
    return err(invalid(`Unexpected "${token.text}"`, token.at))
  }

  const ast = parseExpression(0)
  if (ast.isErr()) return ast
  const trailing = peek()
  if (trailing)
    return err(invalid(`Unexpected "${trailing.text}" after the expression`, trailing.at))
  return ok(ast.value)
}

/** Every variable the formula reads — what an override is validated against. */
export function identifiersOf(ast: FormulaAst): ReadonlySet<string> {
  const names = new Set<string>()
  const walk = (node: FormulaAst): void => {
    switch (node.kind) {
      case 'variable':
        names.add(node.name)
        break
      case 'negate':
        walk(node.operand)
        break
      case 'binary':
        walk(node.left)
        walk(node.right)
        break
      case 'call':
        node.args.forEach(walk)
        break
      case 'number':
        break
    }
  }
  walk(ast)
  return names
}

/**
 * Arity is enforced at parse time; NaN (which evaluation refuses as a
 * non-finite result) is the honest fallback should that invariant ever break.
 */
const APPLY: Record<FunctionName, (args: number[]) => number> = {
  ceil: (args) => Math.ceil(args[0] ?? Number.NaN),
  floor: (args) => Math.floor(args[0] ?? Number.NaN),
  round: (args) => Math.round(args[0] ?? Number.NaN),
  abs: (args) => Math.abs(args[0] ?? Number.NaN),
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
}

export interface Evaluation {
  /** The raw numeric result, before any waste uplift or rounding policy. */
  value: number
  /**
   * The defensibility string: the formula with every variable replaced by
   * `name(value)`. docs/04 §2.7 — when a client disputes 480 m² of tiles for
   * a 420 m² apartment, this line is the answer.
   */
  substituted: string
}

export function evaluateAst(
  ast: FormulaAst,
  inputs: Readonly<Record<string, number>>,
): Result<Evaluation, DomainError> {
  const compute = (node: FormulaAst): Result<number, DomainError> => {
    switch (node.kind) {
      case 'number':
        return ok(node.value)
      case 'variable': {
        const value = inputs[node.name]
        if (value === undefined) {
          return err(
            validationError('FORMULA_INPUT_MISSING', `The formula needs "${node.name}"`, {
              variable: node.name,
            }),
          )
        }
        if (!Number.isFinite(value)) {
          return err(
            validationError('FORMULA_INPUT_INVALID', `"${node.name}" is not a finite number`, {
              variable: node.name,
            }),
          )
        }
        return ok(value)
      }
      case 'negate': {
        const operand = compute(node.operand)
        return operand.isErr() ? operand : ok(-operand.value)
      }
      case 'binary': {
        const left = compute(node.left)
        if (left.isErr()) return left
        const right = compute(node.right)
        if (right.isErr()) return right
        if (node.op === '+') return ok(left.value + right.value)
        if (node.op === '-') return ok(left.value - right.value)
        if (node.op === '*') return ok(left.value * right.value)
        if (right.value === 0) {
          return err(validationError('FORMULA_DIVISION_BY_ZERO', 'The formula divides by zero', {}))
        }
        return ok(left.value / right.value)
      }
      case 'call': {
        const args: number[] = []
        for (const argNode of node.args) {
          const arg = compute(argNode)
          if (arg.isErr()) return arg
          args.push(arg.value)
        }
        return ok(APPLY[node.fn](args))
      }
    }
  }

  const value = compute(ast)
  if (value.isErr()) return err(value.error)
  if (!Number.isFinite(value.value)) {
    return err(
      validationError('FORMULA_RESULT_INVALID', 'The formula produced no finite number', {}),
    )
  }
  return ok({ value: value.value, substituted: render(ast, inputs) })
}

/** Binding strength, for a rendering that adds parentheses only where needed. */
const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 } as const

function render(node: FormulaAst, inputs: Readonly<Record<string, number>>): string {
  switch (node.kind) {
    case 'number':
      return String(node.value)
    case 'variable':
      return `${node.name}(${String(inputs[node.name])})`
    case 'negate':
      return `-${wrap(node.operand, 3, inputs)}`
    case 'binary': {
      const mine = PRECEDENCE[node.op]
      // The right side needs parens at EQUAL precedence too: a - (b - c) and
      // a - b - c are different formulas, and the printed line must not lie.
      return `${wrap(node.left, mine, inputs)} ${node.op} ${wrap(node.right, mine + 1, inputs)}`
    }
    case 'call':
      return `${node.fn}(${node.args.map((arg) => render(arg, inputs)).join(', ')})`
  }
}

function wrap(node: FormulaAst, needed: number, inputs: Readonly<Record<string, number>>): string {
  const strength = node.kind === 'binary' ? PRECEDENCE[node.op] : node.kind === 'negate' ? 0 : 4
  const rendered = render(node, inputs)
  return strength < needed ? `(${rendered})` : rendered
}
