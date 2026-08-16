/**
 * Execution module — PUBLIC CONTRACT. docs/03 §6.1
 */
export {
  STAGE_TRANSITIONS,
  STAGE_REASON_REQUIRED,
  DEFAULT_FINISHING_STAGES,
  weightedProgress,
  type StageStatus,
  type StageSnapshot,
} from './domain/stage'
export {
  UnitWorkflow,
  type UnitWorkflowSnapshot,
  type TransitionRecord,
} from './domain/unit-workflow'
export {
  PrismaUnitWorkflowRepository,
  seedDefaultTemplate,
  type UnitWorkflowRepository,
} from './infrastructure/prisma.repositories'
