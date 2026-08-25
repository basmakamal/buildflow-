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

export {
  Boq,
  type BoqSnapshot,
  type BoqStatus,
  type BoqLine,
  type BoqSection,
  type BoqLineSource,
  type BoqTotals,
  type FinishingLevel,
  type NewLineInput,
} from './domain/boq'

export {
  diffBoqs,
  type BoqDiff,
  type LineDelta,
  type LineFact,
  type LineRef,
} from './domain/boq-diff'

export { extendRate } from './domain/pricing-math'

export { PrismaBoqRepository, BoqQueries, type BoqListRow } from './infrastructure/boq.repository'

export {
  FinishingPackage,
  PACKAGE_TIERS,
  PACKAGE_ELEMENTS,
  type PackageSnapshot,
  type PackageStatus,
  type PackageTier,
  type PackageElement,
  type PackageItem,
  type NewItemInput,
} from './domain/finishing-package'

export {
  planLines,
  roomInputs,
  SECTION_FOR_ELEMENT,
  SECTION_TITLES,
  type RoomFacts,
  type LinePlan,
} from './domain/package-generation'

export {
  generateContent,
  buildBoq,
  estimatePackage,
  type GenerationInputs,
  type GeneratedContent,
  type SkippedLine,
  type BuiltBoq,
  type PackageEstimate,
} from './application/generate-boq.handler'

export {
  PrismaPackageRepository,
  PackageQueries,
  RoomFactsQueries,
  type PackageListRow,
} from './infrastructure/package.repository'

export {
  Quotation,
  type QuotationSnapshot,
  type QuotationStatus,
  type QuotationLanguage,
  type QuotationTotals,
} from './domain/quotation'

export {
  buildQuotationDocument,
  type QuotationDocument,
  type DocumentSection,
  type DocumentLine,
  type DocumentTotalRow,
} from './domain/quotation-document'

export {
  PrismaQuotationRepository,
  QuotationQueries,
  type QuotationListRow,
} from './infrastructure/quotation.repository'
