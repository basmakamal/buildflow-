import type { Database } from '@buildflow/database'
import type { CompanyId, UnitId } from '@buildflow/core'
import { UnitWorkflow, type UnitWorkflowSnapshot } from '../domain/unit-workflow'
import { DEFAULT_FINISHING_STAGES, type StageSnapshot } from '../domain/stage'

/**
 * Persistence for the execution module.
 *
 * Two write paths with different shapes on purpose:
 *  • the workflow row + stage rows are state, saved with optimistic locking;
 *  • stage TRANSITIONS are an append-only log, inserted and never touched —
 *    the field audit trail that answers "who moved this and when".
 */

export interface UnitWorkflowRepository {
  findByUnitId(unitId: UnitId): Promise<UnitWorkflow | null>
  exists(unitId: UnitId): Promise<boolean>
  create(snapshot: UnitWorkflowSnapshot): Promise<void>
  save(workflow: UnitWorkflow): Promise<void>
}

/**
 * Prisma's Decimal stringifies without trailing zeros ('5.40' → '5.4'), but the
 * domain's progress arithmetic and every API response speak fixed 2dp strings.
 * Normalising here keeps the representation stable across a save/load
 * round-trip — without it, a freshly written '5.40' reads back as '5.4' and
 * every equality comparison downstream quietly breaks.
 */
function to2dp(value: unknown): string {
  const [whole = '0', frac = ''] = String(value).split('.')
  return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`
}

export class PrismaUnitWorkflowRepository implements UnitWorkflowRepository {
  constructor(private readonly db: Database) {}

  async findByUnitId(unitId: UnitId): Promise<UnitWorkflow | null> {
    const row = await this.db.unitWorkflow.findFirst({
      where: { unitId },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    })
    if (!row) return null
    return UnitWorkflow.restore({
      id: row.id,
      companyId: row.companyId as CompanyId,
      unitId: row.unitId as UnitId,
      templateId: row.templateId,
      templateVersion: row.templateVersion,
      status: row.status,
      progress: to2dp(row.progressPercentage),
      version: row.version,
      stages: row.stages.map((s): StageSnapshot => ({
        id: s.id,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        sequence: s.sequence,
        weight: String(s.weight),
        status: s.status,
        progress: to2dp(s.progressPercentage),
        requiresApproval: s.requiresApproval,
        actualStartDate: s.actualStartDate,
        actualEndDate: s.actualEndDate,
        completedBy: s.completedBy,
        completedAt: s.completedAt,
        approvedBy: s.approvedBy,
        approvedAt: s.approvedAt,
        blockedReason: s.blockedReason,
        rejectedReason: s.rejectedReason,
      })),
    })
  }

  async exists(unitId: UnitId): Promise<boolean> {
    return (await this.db.unitWorkflow.count({ where: { unitId } })) > 0
  }

  async create(snapshot: UnitWorkflowSnapshot): Promise<void> {
    await this.db.unitWorkflow.create({
      data: {
        id: snapshot.id,
        unitId: snapshot.unitId,
        templateId: snapshot.templateId,
        templateVersion: snapshot.templateVersion,
        status: snapshot.status,
        progressPercentage: snapshot.progress,
        startedAt: new Date(),
      } as never,
    })
    for (const stage of snapshot.stages) {
      await this.db.unitStage.create({
        data: {
          id: stage.id,
          unitWorkflowId: snapshot.id,
          unitId: snapshot.unitId,
          code: stage.code,
          nameEn: stage.nameEn,
          nameAr: stage.nameAr,
          sequence: stage.sequence,
          weight: stage.weight,
          status: stage.status,
          progressPercentage: stage.progress,
          requiresApproval: stage.requiresApproval,
        } as never,
      })
    }
  }

  async save(workflow: UnitWorkflow): Promise<void> {
    const snapshot = workflow.toSnapshot()

    const result = await this.db.unitWorkflow.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        status: snapshot.status,
        progressPercentage: snapshot.progress,
        ...(snapshot.status === 'completed' ? { completedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      // Concurrent site updates are ROUTINE, not exceptional — an engineer's
      // offline sync and a manager's approval land together. The loser retries
      // against fresh state rather than silently overwriting. docs/02 §5
      throw new Error(`Concurrent modification of UnitWorkflow ${snapshot.id}`)
    }

    for (const stage of snapshot.stages) {
      await this.db.unitStage.update({
        where: { id: stage.id },
        data: {
          status: stage.status,
          progressPercentage: stage.progress,
          actualStartDate: stage.actualStartDate,
          actualEndDate: stage.actualEndDate,
          completedBy: stage.completedBy,
          completedAt: stage.completedAt,
          approvedBy: stage.approvedBy,
          approvedAt: stage.approvedAt,
          blockedReason: stage.blockedReason,
          rejectedReason: stage.rejectedReason,
        },
      })
    }

    // Append-only: the transitions log never sees an UPDATE.
    for (const t of workflow.pullTransitions()) {
      await this.db.stageTransition.create({
        data: {
          id: crypto.randomUUID(),
          unitStageId: t.stageId,
          fromStatus: t.fromStatus,
          toStatus: t.toStatus,
          progressBefore: t.progressBefore,
          progressAfter: t.progressAfter,
          actorUserId: t.actor,
          reason: t.reason,
          occurredAt: t.occurredAt,
        } as never,
      })
    }

    // The unit's denormalised progress — what lists and the portal read.
    await this.db.unit.updateMany({
      where: { id: snapshot.unitId },
      data: { progressPercentage: snapshot.progress },
    })
  }
}

/**
 * Seeds the system default 14-stage template (companyId null) once.
 * Idempotent — safe on every boot.
 */
export async function seedDefaultTemplate(db: Database, generateId: () => string): Promise<string> {
  const existing = await db.workflowTemplate.findFirst({
    where: { companyId: null, code: 'finishing_default' },
  })
  if (existing) return existing.id

  const templateId = generateId()
  await db.workflowTemplate.create({
    data: {
      id: templateId,
      companyId: null,
      code: 'finishing_default',
      nameEn: 'Standard Finishing',
      nameAr: 'التشطيب القياسي',
      isDefault: true,
    },
  })
  let sequence = 1
  for (const stage of DEFAULT_FINISHING_STAGES) {
    await db.workflowStageTemplate.create({
      data: {
        id: generateId(),
        companyId: null,
        templateId,
        code: stage.code,
        nameEn: stage.nameEn,
        nameAr: stage.nameAr,
        sequence: sequence++,
        weight: stage.weight,
        requiresApproval: stage.requiresApproval,
      },
    })
  }
  return templateId
}
