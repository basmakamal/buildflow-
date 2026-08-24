import type { FastifyInstance } from 'fastify'
import type { DomainError } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  EstimationRuleRepository,
  evaluateRule,
  validateOverride,
  type EstimationRule,
} from '@buildflow/estimation'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * The quantity rule engine over HTTP. Phase 4 sprints 1–2. docs/02 §3.7
 *
 * GET lists the tenant's EFFECTIVE catalogue — shipped rules with the
 * tenant's replacements merged in. PUT/DELETE manage one rule's override:
 * waste factors are the single most-adjusted value per company, and a
 * replacement formula is validated at write time against the rule's declared
 * inputs, in front of its author — never during a BOQ run months later.
 * The evaluate endpoint returns the defensibility string the BOQ line will
 * carry: `perimeter_m(24) * height_m(3) - openings_m2(4.2) = 67.8000`.
 */
export function registerEstimationRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const rules = new EstimationRuleRepository(db)

  const WASTE = '^\\d{1,3}(\\.\\d{1,2})?$'
  const INPUT = '^-?\\d{1,10}(\\.\\d{1,4})?$'

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }

  app.get(
    '/api/v1/estimation/rules',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request) => {
      const principal = principalOf(request)
      return { data: await rules.effectiveForCompany(principal.companyId) }
    },
  )

  app.post<{ Params: { code: string }; Body: { inputs: Record<string, string> } }>(
    '/api/v1/estimation/rules/:code/evaluate',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        body: {
          type: 'object',
          required: ['inputs'],
          additionalProperties: false,
          properties: {
            inputs: {
              type: 'object',
              maxProperties: 20,
              additionalProperties: { type: 'string', pattern: INPUT },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const rule = await rules.findEffective(principal.companyId, request.params.code)
      if (!rule) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = evaluateRule(rule, request.body.inputs)
      if (result.isErr()) return sendError(reply, request.id, result.error)
      return result.value
    },
  )

  app.put<{
    Params: { code: string }
    Body: { formula?: string; wastePct?: string; isActive?: boolean; notes?: string | null }
  }>(
    '/api/v1/estimation/rules/:code/override',
    {
      preHandler: [authenticate(c), requirePermission('boq.update')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            formula: { type: 'string', minLength: 1, maxLength: 500 },
            wastePct: { type: 'string', pattern: WASTE },
            isActive: { type: 'boolean' },
            notes: { type: ['string', 'null'], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const base = await rules.findEffective(principal.companyId, request.params.code)
      if (!base) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      const formula = request.body.formula ?? base.formula
      const validated = validateOverride(formula, base.inputs, request.body.wastePct)
      if (validated.isErr()) return sendError(reply, request.id, validated.error)

      const next: EstimationRule = {
        ...base,
        formula,
        wastePct: request.body.wastePct ?? base.wastePct,
        isActive: request.body.isActive ?? base.isActive,
        notesEn: request.body.notes !== undefined ? request.body.notes : base.notesEn,
        isOverride: true,
      }
      await rules.saveOverride(principal.companyId, next)
      return next
    },
  )

  app.delete<{ Params: { code: string } }>(
    '/api/v1/estimation/rules/:code/override',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request, reply) => {
      const principal = principalOf(request)
      const removed = await rules.removeOverride(principal.companyId, request.params.code)
      if (!removed) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const restored = await rules.findEffective(principal.companyId, request.params.code)
      return { code: request.params.code, restored }
    },
  )
}
