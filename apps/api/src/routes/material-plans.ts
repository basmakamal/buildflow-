import type { FastifyInstance } from 'fastify'
import type { BoqId, DomainError } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { ShortageQueries } from '@buildflow/catalogue'
import { Budget, BudgetQueries, PrismaBudgetRepository } from '@buildflow/procurement'
import {
  MaterialPlanQueries,
  PrismaBoqRepository,
  PrismaMaterialPlanRepository,
  foldPlannedTotals,
  issueMaterialPlan,
} from '@buildflow/estimation'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * BOQ → material plan → budget baseline. Phase 4 sprint 8, and the seam that
 * closes the loop back to Phase 3. docs/02 §1.1, docs/04 §2.9
 *
 * One command, three effects that must agree because they come from ONE
 * document: the plan rows are written, their totals are projected into
 * material_balances (giving `planned_quantity` a source at last), and a budget
 * baseline is stamped with this BOQ's id — the `boqId` left nullable back in
 * the budgets sprint with the note that it lands with the Phase 4 BOQ.
 *
 * Issuing is idempotent on the BOQ line key, because "issue the plan" is
 * exactly the button someone presses twice.
 */
export function registerMaterialPlanRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const boqs = new PrismaBoqRepository(db)
  const plans = new PrismaMaterialPlanRepository(db)
  const planQueries = new MaterialPlanQueries(db)
  const budgets = new PrismaBudgetRepository(db)
  const units = new BudgetQueries(db)
  const shortages = new ShortageQueries(db)

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }
  const notFound = (reply: Replyish, requestId: unknown) =>
    reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, requestId))

  /**
   * No body schema: issuing a plan is a command, and a command endpoint that
   * rejects a POST for arriving without an empty object is hostile to every
   * client. The one optional field is checked here instead.
   */
  app.post<{ Params: { boqId: string }; Body?: { revisionReason?: string } }>(
    '/api/v1/boqs/:boqId/issue-material-plan',
    { preHandler: [authenticate(c), requirePermission('boq.approve')] },
    async (request, reply) => {
      const principal = principalOf(request)
      const revisionReason = request.body?.revisionReason
      if (revisionReason !== undefined && revisionReason.length > 500) {
        return reply
          .status(400)
          .send(
            problem(
              'VALIDATION_FAILED',
              'The revision reason is at most 500 characters',
              400,
              request.id,
            ),
          )
      }
      const boq = await boqs.findById(request.params.boqId as BoqId)
      if (!boq) return notFound(reply, request.id)

      const now = c.clock.now()
      const issued = issueMaterialPlan(boq.toSnapshot(), principal.userId, now, c.ids)
      if (issued.isErr()) return sendError(reply, request.id, issued.error)

      const written = await plans.issue(issued.value.rows)
      // Re-issuing writes nothing new; the projection is refreshed either way,
      // because the plan is the authority on what was planned.
      await plans.project(
        principal.companyId,
        foldPlannedTotals(issued.value.rows),
        () => c.ids.next(),
        now,
      )

      // The baseline, from the same document in the same breath — a plan and a
      // budget derived from different BOQ versions is a variance report nobody
      // can explain.
      const latest = await budgets.latestForScope(boq.unitId, null)
      const baseline = latest
        ? latest.revise({
            id: c.ids.next<'BudgetId'>(),
            buckets: issued.value.buckets,
            boqId: String(boq.id),
            baselineAt: now,
            approvedBy: principal.userId,
            revisionReason: revisionReason ?? `Baselined from BOQ v${String(boq.versionNumber)}`,
          })
        : Budget.baseline({
            id: c.ids.next<'BudgetId'>(),
            companyId: principal.companyId,
            unitId: boq.unitId,
            unitStageId: null,
            boqId: String(boq.id),
            buckets: issued.value.buckets,
            currency: issued.value.currency,
            baselineAt: now,
            approvedBy: principal.userId,
            revisionReason: `Baselined from BOQ v${String(boq.versionNumber)}`,
          })

      let budgetResult: { id: string; revision: number; totalBudget: string } | null = null
      if (baseline.isOk()) {
        if (await budgets.create(baseline.value)) {
          const snapshot = baseline.value.toSnapshot()
          budgetResult = {
            id: String(snapshot.id),
            revision: snapshot.revision,
            totalBudget: snapshot.totalBudget,
          }
        }
      } else if (baseline.error.code !== 'BUDGET_REVISION_UNCHANGED') {
        // A baseline that already says exactly this is not a failure — the
        // plan was simply re-issued against an unchanged BOQ. Anything else is.
        return sendError(reply, request.id, baseline.error)
      }

      return reply.status(201).send({
        boqId: boq.id,
        planRowsWritten: written,
        planRowsTotal: issued.value.rows.length,
        alreadyIssued: written === 0,
        unplannable: issued.value.unplannable,
        budget: budgetResult,
      })
    },
  )

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/material-plan',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      if (!(await units.unitCurrency(request.params.unitId))) return notFound(reply, request.id)
      return { data: await planQueries.forUnit(request.params.unitId) }
    },
  )

  /** "Will we run out before we finish?" — the site's actual question. */
  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/shortages',
    { preHandler: [authenticate(c), requirePermission('material.view')] },
    async (request, reply) => {
      if (!(await units.unitCurrency(request.params.unitId))) return notFound(reply, request.id)
      return { data: await shortages.forUnit(request.params.unitId) }
    },
  )
}
