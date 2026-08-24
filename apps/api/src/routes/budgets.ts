import type { FastifyInstance } from 'fastify'
import type { DomainError } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  Budget,
  BudgetQueries,
  BudgetWatchdog,
  PrismaBudgetRepository,
  ProfitabilityQueries,
} from '@buildflow/procurement'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Budgets and the first profitability report. Phase 3 sprint 8. docs/04 §2.9
 *
 * Budgets are append-only revisions: POST creates revision 1 for a scope, or
 * revision n+1 with a mandatory reason — there is no PUT and no DELETE, because
 * a baseline that can be edited after the fact is not a baseline. The
 * permissions mirror the money-visibility ladder: cost.update_budget writes the
 * baseline, cost.view reads it, cost.view_margin reads the profitability
 * report — the margin is the number the site crew must never see. docs/11 §3.3
 */
export function registerBudgetRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const budgets = new PrismaBudgetRepository(db)
  const queries = new BudgetQueries(db)
  const profitability = new ProfitabilityQueries(db)
  const watchdog = new BudgetWatchdog(db, c.ids, c.clock)

  const DECIMAL = '^\\d{1,14}(\\.\\d{1,4})?$'

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }

  app.post<{
    Params: { unitId: string }
    Body: {
      unitStageId?: string | null
      boqId?: string | null
      materialBudget: string
      labourBudget: string
      equipmentBudget: string
      overheadBudget: string
      currency: string
      revisionReason?: string
    }
  }>(
    '/api/v1/units/:unitId/budgets',
    {
      preHandler: [authenticate(c), requirePermission('cost.update_budget')],
      schema: {
        body: {
          type: 'object',
          required: [
            'materialBudget',
            'labourBudget',
            'equipmentBudget',
            'overheadBudget',
            'currency',
          ],
          additionalProperties: false,
          properties: {
            unitStageId: { type: ['string', 'null'], maxLength: 36 },
            boqId: { type: ['string', 'null'], maxLength: 36 },
            materialBudget: { type: 'string', pattern: DECIMAL },
            labourBudget: { type: 'string', pattern: DECIMAL },
            equipmentBudget: { type: 'string', pattern: DECIMAL },
            overheadBudget: { type: 'string', pattern: DECIMAL },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            revisionReason: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const unitId = request.params.unitId

      const unitCurrency = await queries.unitCurrency(unitId)
      if (!unitCurrency) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      // Refused up front rather than converted: a budget in a currency the unit
      // is not costed in makes every variance a conversion question.
      if (request.body.currency !== unitCurrency) {
        return reply
          .status(400)
          .send(
            problem(
              'BUDGET_CURRENCY_MISMATCH',
              `This unit is costed in ${unitCurrency}`,
              400,
              request.id,
            ),
          )
      }

      const unitStageId = request.body.unitStageId ?? null
      const buckets = {
        materialBudget: request.body.materialBudget,
        labourBudget: request.body.labourBudget,
        equipmentBudget: request.body.equipmentBudget,
        overheadBudget: request.body.overheadBudget,
      }

      const latest = await budgets.latestForScope(unitId, unitStageId)
      const next = latest
        ? latest.revise({
            id: c.ids.next<'BudgetId'>(),
            buckets,
            boqId: request.body.boqId ?? null,
            baselineAt: c.clock.now(),
            approvedBy: principal.userId,
            revisionReason: request.body.revisionReason ?? '',
          })
        : Budget.baseline({
            id: c.ids.next<'BudgetId'>(),
            companyId: principal.companyId,
            unitId,
            unitStageId,
            boqId: request.body.boqId ?? null,
            buckets,
            currency: request.body.currency,
            baselineAt: c.clock.now(),
            approvedBy: principal.userId,
            revisionReason: request.body.revisionReason ?? null,
          })
      if (next.isErr()) return sendError(reply, request.id, next.error)

      if (!(await budgets.create(next.value))) {
        return reply
          .status(409)
          .send(
            problem(
              'BUDGET_REVISION_CONFLICT',
              'Someone else revised this budget at the same time — reload and try again',
              409,
              request.id,
            ),
          )
      }

      // A baseline approved BELOW money already spent is exceeded from birth —
      // exactly the thing the approver wants to hear about immediately.
      await watchdog.sweep([{ unitId, unitStageId }], principal.userId)

      const snapshot = next.value.toSnapshot()
      return reply.status(201).send({
        id: snapshot.id,
        revision: snapshot.revision,
        totalBudget: snapshot.totalBudget,
      })
    },
  )

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/budgets',
    { preHandler: [authenticate(c), requirePermission('cost.view')] },
    async (request, reply) => {
      if (!(await queries.unitCurrency(request.params.unitId))) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      return { data: await queries.history(request.params.unitId) }
    },
  )

  /** "Did unit 305 make money, and where did it leak?" — the sprint's exit criterion. */
  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/profitability',
    { preHandler: [authenticate(c), requirePermission('cost.view_margin')] },
    async (request, reply) => {
      const report = await profitability.forUnit(request.params.unitId)
      if (!report) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      return report
    },
  )
}
