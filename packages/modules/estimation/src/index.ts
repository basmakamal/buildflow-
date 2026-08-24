/**
 * Estimation module — PUBLIC CONTRACT. docs/03 §6.1
 *
 * The quantity rule engine: a declarative take-off catalogue with a safe
 * formula evaluator, waste factors, and per-tenant overrides. Phase 4
 * sprints 1–2. docs/02 §3.7, docs/04 §2.7
 */
export {
  parseFormula,
  evaluateAst,
  identifiersOf,
  FORMULA_FUNCTIONS,
  type FormulaAst,
  type FunctionName,
  type Evaluation,
} from './domain/formula'

export {
  evaluateRule,
  parseRuleInputs,
  validateOverride,
  type EstimationRule,
  type RuleInput,
  type RuleEvaluation,
} from './domain/estimation-rule'

export { EstimationRuleRepository } from './infrastructure/estimation.repository'

export {
  RateCard,
  coversDate,
  pickRateCard,
  type RateCardSnapshot,
  type RateCardStatus,
  type RateItem,
  type ResolvableCard,
} from './domain/rate-card'

export {
  PrismaRateCardRepository,
  RateCardQueries,
  type RateCardListRow,
} from './infrastructure/rate-card.repository'

export {
  seedStarterRateCard,
  STARTER_RATE_CARD_NAME,
  type SeedResult,
} from './infrastructure/rate-card-seeder'
