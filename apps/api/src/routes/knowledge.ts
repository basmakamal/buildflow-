import type { FastifyInstance } from 'fastify'
import type { UnitId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { PrismaUnitRepository } from '@buildflow/project'
import {
  AnalyzeRoomHandler,
  ManageRulesHandler,
  PrismaFactCatalogue,
  PrismaRuleCatalogue,
  PrismaRuleReader,
  RULE_DOMAINS,
  RULE_TYPES,
  SEVERITIES,
  type FactValue,
  type RuleDomain,
  type RuleType,
  type SaveOverrideCommand,
} from '@buildflow/knowledge'
import type { Container } from '../container'
import { authenticate, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * AI knowledge-base routes.
 *
 * Analysis is a read: it derives facts from a room that already exists, runs the
 * rule engine, and returns findings. Nothing is persisted, so `unit.view` is the
 * correct permission — requiring `unit.update` would stop a client or a viewer
 * from seeing why a room was flagged.
 */
export function registerKnowledgeRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const units = new PrismaUnitRepository(db)

  app.post<{
    Params: { unitId: string; roomId: string }
    // `| undefined` is not decoration: every property is optional, so a caller
    // may legitimately POST no body at all, and Fastify hands us undefined.
    Body:
      | {
          facts?: Record<string, FactValue>
          domains?: RuleDomain[]
          ruleTypes?: RuleType[]
        }
      | undefined
  }>(
    '/api/v1/units/:unitId/rooms/:roomId/analyze',
    {
      preHandler: [authenticate(c), requirePermission('unit.view')],
      schema: {
        body: {
          // `null` is permitted because every property is optional: analysing a
          // room as recorded is the common case and needs no body at all.
          // Fastify hands the validator null for a bodyless POST, which a bare
          // `type: 'object'` would reject with 400 before the handler ran.
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            /**
             * Hypothetical facts overlaid on the room's real geometry — lets a
             * designer ask "what if this room had 4 sockets" before an
             * electrical model exists. Values only; unknown codes are echoed
             * back in `ignoredFacts` rather than silently dropped.
             */
            facts: {
              type: 'object',
              maxProperties: 60,
              // A `type` array, NOT anyOf. Fastify's Ajv runs with coerceTypes
              // and removeAdditional, and inside an anyOf it fails to coerce
              // and then silently STRIPS every supplied fact — the endpoint
              // returns 200 with no findings and no error. The union form logs
              // a harmless strictTypes warning at boot; that is the better
              // trade against losing the payload without a signal.
              additionalProperties: {
                type: ['string', 'number', 'boolean', 'null'],
              },
            },
            domains: { type: 'array', items: { enum: [...RULE_DOMAINS] }, maxItems: 8 },
            ruleTypes: { type: 'array', items: { enum: [...RULE_TYPES] }, maxItems: 2 },
          },
        },
      },
    },
    async (request, reply) => {
      const unit = await units.findById(request.params.unitId as UnitId)
      // 404 rather than 403 — the id may belong to another tenant, and the
      // response must be indistinguishable from "never existed". docs/07 §12
      if (!unit) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      const room = unit.rooms.find((candidate) => candidate.id === request.params.roomId)
      if (!room) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      // A rule that fails to load is logged, not thrown: one malformed row in
      // the admin panel must not break analysis for every room in the tenant.
      const rules = new PrismaRuleReader(db, (code, reason) => {
        request.log.warn({ ruleCode: code, reason, requestId: request.id }, 'kb rule skipped')
      })
      const handler = new AnalyzeRoomHandler(rules, new PrismaFactCatalogue(db))

      const result = await handler.handle({
        room: {
          typeCode: room.typeCode,
          widthMm: room.widthMm,
          lengthMm: room.lengthMm,
          heightMm: room.heightMm,
        },
        // Inherited by every room in the unit; finishLevel alone is referenced
        // by nineteen rule conditions.
        unit: unit.programme,
        ...(request.body?.facts ? { supplied: request.body.facts } : {}),
        ...(request.body?.domains ? { domains: request.body.domains } : {}),
        ...(request.body?.ruleTypes ? { ruleTypes: request.body.ruleTypes } : {}),
      })

      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      const analysis = result.value
      return {
        roomId: room.id,
        roomType: room.typeCode,
        kbRoomCode: analysis.kbRoomCode,
        // Every finding carries both languages; the client renders whichever
        // matches its locale rather than the server guessing. docs/12
        findings: analysis.findings,
        coverage: analysis.coverage,
        ignoredFacts: analysis.ignoredFacts,
      }
    },
  )

  // ── Rule administration ──────────────────────────────────────────────────
  //
  // Business users retune the engine here without a deploy. Reads need
  // `knowledge.view`; every write needs `knowledge.manage`, which is in
  // DANGEROUS_PERMISSIONS — disabling a rule silences a safety check for every
  // room in the tenant, and does so invisibly.

  const catalogueFor = (request: { id: string; log: { warn: (o: object, m: string) => void } }) =>
    new PrismaRuleCatalogue(db, (code, reason) => {
      request.log.warn({ ruleCode: code, reason, requestId: request.id }, 'kb rule invalid')
    })

  app.get(
    '/api/v1/knowledge/rules',
    { preHandler: [authenticate(c), requirePermission('knowledge.view')] },
    async (request) => {
      const handler = new ManageRulesHandler(catalogueFor(request), catalogueFor(request))
      return { data: await handler.list() }
    },
  )

  /**
   * The vocabulary the admin panel builds its condition editor from. Serving it
   * is what makes a new rule pure data: the client renders a field dropdown
   * from `facts`, picks the input widget from `dataType`, and populates value
   * choices from `allowedValues` — no code change to add a rule.
   */
  app.get(
    '/api/v1/knowledge/vocabulary',
    { preHandler: [authenticate(c), requirePermission('knowledge.view')] },
    async (request) => {
      const handler = new ManageRulesHandler(catalogueFor(request), catalogueFor(request))
      return handler.vocabulary()
    },
  )

  app.put<{ Params: { code: string }; Body: Omit<SaveOverrideCommand, 'code'> }>(
    '/api/v1/knowledge/rules/:code',
    {
      preHandler: [authenticate(c), requirePermission('knowledge.manage')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            isDisabled: { type: 'boolean' },
            ruleType: { enum: [...RULE_TYPES] },
            domain: { enum: [...RULE_DOMAINS] },
            roomTypeCode: { type: ['string', 'null'], maxLength: 64 },
            // Left unconstrained here on purpose: shape is validated in the
            // domain against the live fact vocabulary, which JSON Schema
            // cannot see. A schema copy would drift the moment a fact is added.
            conditions: { type: 'object' },
            severity: { enum: [...SEVERITIES] },
            messageEn: { type: 'string', minLength: 1, maxLength: 500 },
            messageAr: { type: 'string', minLength: 1, maxLength: 500 },
            action: { type: ['object', 'null'] },
            priority: { type: 'integer', minimum: 0, maximum: 32767 },
          },
        },
      },
    },
    async (request, reply) => {
      const handler = new ManageRulesHandler(catalogueFor(request), catalogueFor(request))
      const result = await handler.save({ code: request.params.code, ...request.body })

      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }
      return result.value
    },
  )

  /** Drops the tenant's override so the shipped rule applies again. */
  app.delete<{ Params: { code: string } }>(
    '/api/v1/knowledge/rules/:code',
    { preHandler: [authenticate(c), requirePermission('knowledge.manage')] },
    async (request, reply) => {
      const handler = new ManageRulesHandler(catalogueFor(request), catalogueFor(request))
      const result = await handler.revert(request.params.code)

      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }
      return result.value
    },
  )
}
