import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  SystemClock,
  Uuid7Generator,
  type DomainError,
  type Result,
  type UnitId,
} from '@buildflow/core'
import { runWithoutTenantScope, type Database } from '@buildflow/database'
import {
  PrismaUnitWorkflowRepository,
  seedDefaultTemplate,
  type StageSnapshot,
  type UnitWorkflow,
  type UnitWorkflowRepository,
} from '@buildflow/execution'
import { PrismaUnitRepository } from '@buildflow/project'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Workflow and stage routes — the daily loop's API surface.
 *
 * One deliberate asymmetry: engineers COMPLETE (stage.complete), managers
 * APPROVE (stage.approve), and the domain refuses self-approval regardless of
 * permissions — holding both permissions does not collapse the two roles into
 * one person for the same stage. docs/01 WFL-07
 */

const clock = new SystemClock()
const ids = new Uuid7Generator()

export function registerWorkflowRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const workflows: UnitWorkflowRepository = new PrismaUnitWorkflowRepository(db)
  const units = new PrismaUnitRepository(db)

  const NOT_FOUND = (id: unknown) => problem('NOT_FOUND', 'Resource not found', 404, id)

  /** Applies a domain result to the HTTP reply, saving on success. */
  const respond = async (
    workflow: UnitWorkflow,
    result: Result<void, DomainError>,
    reply: FastifyReply,
    requestId: unknown,
  ): Promise<void> => {
    if (result.isErr()) {
      const status = statusFor(result.error)
      await reply
        .status(status)
        .send(problem(result.error.code, result.error.message, status, requestId))
      return
    }
    await workflows.save(workflow)
    const snapshot = workflow.toSnapshot()
    await reply.send({ unitProgress: snapshot.progress, workflowStatus: snapshot.status })
  }

  app.post<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/workflow',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const unitId = request.params.unitId as UnitId
      const unit = await units.findById(unitId)
      if (!unit) return reply.status(404).send(NOT_FOUND(request.id))

      if (await workflows.exists(unitId)) {
        return reply
          .status(409)
          .send(problem('WORKFLOW_EXISTS', 'This unit already has a workflow', 409, request.id))
      }

      // The template catalogue is platform-global (companyId null), so both the
      // seed and the read run outside tenant scope — one of the documented
      // exceptions. The INSTANTIATED workflow below is fully tenant-scoped.
      const principal = principalOf(request)
      const { templateId, stages } = await runWithoutTenantScope(
        {
          userId: principal.userId,
          requestId: request.id,
          source: 'api',
          locale: 'ar',
        },
        async () => {
          const tid = await seedDefaultTemplate(db, () => ids.next())
          const template = await db.workflowTemplate.findFirst({
            where: { id: tid },
            include: { stages: { orderBy: { sequence: 'asc' } } },
          })
          return { templateId: tid, stages: template?.stages ?? [] }
        },
      )

      const workflowId = ids.next()
      await workflows.create({
        id: workflowId,
        companyId: principal.companyId,
        unitId,
        templateId,
        templateVersion: 1,
        status: 'active',
        progress: '0.00',
        version: 0,
        stages: stages.map((s): StageSnapshot => ({
          id: ids.next(),
          code: s.code,
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          sequence: s.sequence,
          weight: String(s.weight),
          status: 'not_started',
          progress: '0.00',
          requiresApproval: s.requiresApproval,
          actualStartDate: null,
          actualEndDate: null,
          completedBy: null,
          completedAt: null,
          approvedBy: null,
          approvedAt: null,
          blockedReason: null,
          rejectedReason: null,
        })),
      })
      return reply.status(201).send({ id: workflowId, stageCount: stages.length })
    },
  )

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/stages',
    { preHandler: [authenticate(c), requirePermission('stage.view')] },
    async (request, reply) => {
      const workflow = await workflows.findByUnitId(request.params.unitId as UnitId)
      if (!workflow) return reply.status(404).send(NOT_FOUND(request.id))
      const snapshot = workflow.toSnapshot()
      return {
        unitId: snapshot.unitId,
        status: snapshot.status,
        progress: snapshot.progress,
        stages: snapshot.stages.map((s) => ({
          id: s.id,
          code: s.code,
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          sequence: s.sequence,
          weight: s.weight,
          status: s.status,
          progress: s.progress,
          requiresApproval: s.requiresApproval,
          blockedReason: s.blockedReason,
          rejectedReason: s.rejectedReason,
        })),
      }
    },
  )

  type StageParams = { Params: { unitId: string; stageId: string } }

  const loadWorkflow = async (
    unitId: string,
    reply: FastifyReply,
    requestId: unknown,
  ): Promise<UnitWorkflow | null> => {
    const workflow = await workflows.findByUnitId(unitId as UnitId)
    if (!workflow) {
      await reply.status(404).send(NOT_FOUND(requestId))
      return null
    }
    return workflow
  }

  app.post<StageParams>(
    '/api/v1/units/:unitId/stages/:stageId/start',
    { preHandler: [authenticate(c), requirePermission('stage.update_progress')] },
    async (request, reply) => {
      const workflow = await loadWorkflow(request.params.unitId, reply, request.id)
      if (!workflow) return
      const result = workflow.startStage(request.params.stageId, principalOf(request).userId, clock)
      return respond(workflow, result, reply, request.id)
    },
  )

  app.patch<StageParams & { Body: { progress: string } }>(
    '/api/v1/units/:unitId/stages/:stageId/progress',
    {
      preHandler: [authenticate(c), requirePermission('stage.update_progress')],
      schema: {
        body: {
          type: 'object',
          required: ['progress'],
          properties: { progress: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' } },
        },
      },
    },
    async (request, reply) => {
      const workflow = await loadWorkflow(request.params.unitId, reply, request.id)
      if (!workflow) return
      const result = workflow.updateProgress(
        request.params.stageId,
        request.body.progress,
        principalOf(request).userId,
        clock,
      )
      return respond(workflow, result, reply, request.id)
    },
  )

  app.post<StageParams>(
    '/api/v1/units/:unitId/stages/:stageId/complete',
    { preHandler: [authenticate(c), requirePermission('stage.complete')] },
    async (request, reply) => {
      const workflow = await loadWorkflow(request.params.unitId, reply, request.id)
      if (!workflow) return
      const result = workflow.completeStage(
        request.params.stageId,
        principalOf(request).userId,
        clock,
      )
      return respond(workflow, result, reply, request.id)
    },
  )

  app.post<StageParams>(
    '/api/v1/units/:unitId/stages/:stageId/approve',
    { preHandler: [authenticate(c), requirePermission('stage.approve')] },
    async (request, reply) => {
      const workflow = await loadWorkflow(request.params.unitId, reply, request.id)
      if (!workflow) return
      const result = workflow.approveStage(
        request.params.stageId,
        principalOf(request).userId,
        clock,
      )
      return respond(workflow, result, reply, request.id)
    },
  )

  app.post<StageParams & { Body: { reason: string } }>(
    '/api/v1/units/:unitId/stages/:stageId/reject',
    {
      preHandler: [authenticate(c), requirePermission('stage.reject')],
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const workflow = await loadWorkflow(request.params.unitId, reply, request.id)
      if (!workflow) return
      const result = workflow.rejectStage(
        request.params.stageId,
        principalOf(request).userId,
        clock,
        request.body.reason,
      )
      return respond(workflow, result, reply, request.id)
    },
  )

  app.post<StageParams & { Body: { reason: string } }>(
    '/api/v1/units/:unitId/stages/:stageId/block',
    {
      preHandler: [authenticate(c), requirePermission('stage.update_progress')],
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const workflow = await loadWorkflow(request.params.unitId, reply, request.id)
      if (!workflow) return
      const result = workflow.blockStage(
        request.params.stageId,
        principalOf(request).userId,
        clock,
        request.body.reason,
      )
      return respond(workflow, result, reply, request.id)
    },
  )
}
