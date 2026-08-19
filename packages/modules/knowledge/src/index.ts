/**
 * Knowledge module — PUBLIC CONTRACT. docs/03 §6.1
 *
 * The AI engine's rule evaluation: standards and rules authored in
 * @buildflow/knowledge-base, evaluated against facts derived from a room.
 */
export {
  evaluate,
  parseCondition,
  RULE_TYPES,
  RULE_DOMAINS,
  SEVERITIES,
  OPERATORS,
  type Rule,
  type RuleType,
  type RuleDomain,
  type Severity,
  type Operator,
  type Condition,
  type ConditionLeaf,
  type Facts,
  type FactValue,
  type Finding,
  type SkippedRule,
  type EvaluationResult,
} from './domain/rule'

export {
  deriveRoomFacts,
  mergeFacts,
  ROOM_TYPE_TO_KB,
  type RoomInput,
  type UnitContext,
  type DerivedFacts,
} from './domain/room-facts'

export { type RuleReader, type FactCatalogue } from './domain/ports'

export {
  validateRuleDraft,
  targetedRoomTypes,
  type FactDefinition,
  type RuleDraft,
  type ValidationContext,
} from './domain/rule-validation'

export {
  ManageRulesHandler,
  type EffectiveRule,
  type OverrideDraft,
  type SaveOverrideCommand,
  type RuleCatalogueReader,
  type RuleOverrideWriter,
} from './application/manage-rules.handler'

export {
  AnalyzeRoomHandler,
  type AnalyzeRoomCommand,
  type AnalyzeRoomResult,
  type CoverageReport,
} from './application/analyze-room.handler'

export {
  PrismaRuleReader,
  PrismaFactCatalogue,
  PrismaRuleCatalogue,
} from './infrastructure/prisma.repositories'
