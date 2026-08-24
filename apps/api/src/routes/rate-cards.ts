import type { FastifyInstance } from 'fastify'
import type { DomainError, RateCardId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { UNIT_OF_MEASURE_CODES } from '@buildflow/catalogue'
import {
  PrismaRateCardRepository,
  RateCard,
  RateCardQueries,
  seedStarterRateCard,
} from '@buildflow/estimation'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Rate cards over HTTP. Phase 4 sprint 3. docs/04 §2.7
 *
 * The lifecycle IS the pricing discipline: items are editable while draft,
 * frozen on activation, and new prices are a NEW card with a new effective
 * window — because a BOQ resolves rates by its pricing date, never by "now",
 * and editing an active card would restate documents priced from it.
 */
export function registerRateCardRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const cards = new PrismaRateCardRepository(db)
  const queries = new RateCardQueries(db)

  const RATE = '^\\d{1,14}(\\.\\d{1,4})?$'
  const DATE = '^\\d{4}-\\d{2}-\\d{2}$'

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }

  app.get<{ Querystring: { status?: 'draft' | 'active' | 'archived' } }>(
    '/api/v1/rate-cards',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { enum: ['draft', 'active', 'archived'] } },
        },
      },
    },
    async (request) => ({ data: await queries.list(request.query.status) }),
  )

  /**
   * The resolution a BOQ run will use: which card prices this date, here?
   * Static segment before the :cardId routes on purpose.
   */
  app.get<{ Querystring: { date: string; city?: string } }>(
    '/api/v1/rate-cards/resolve',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        querystring: {
          type: 'object',
          required: ['date'],
          additionalProperties: false,
          properties: {
            date: { type: 'string', pattern: DATE },
            city: { type: 'string', minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      const resolved = await queries.resolve(
        new Date(`${request.query.date}T00:00:00Z`),
        request.query.city ?? null,
      )
      if (!resolved) {
        return reply
          .status(404)
          .send(
            problem(
              'RATE_CARD_NONE_EFFECTIVE',
              'No active rate card covers this date',
              404,
              request.id,
            ),
          )
      }
      return resolved
    },
  )

  app.get<{ Params: { cardId: string } }>(
    '/api/v1/rate-cards/:cardId',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      const card = await cards.findById(request.params.cardId as RateCardId)
      if (!card) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      return card.toSnapshot()
    },
  )

  app.post<{
    Body: {
      name: string
      countryCode: string
      city?: string | null
      currency: string
      effectiveFrom: string
      effectiveTo?: string | null
      isDefault?: boolean
    }
  }>(
    '/api/v1/rate-cards',
    {
      preHandler: [authenticate(c), requirePermission('boq.update')],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'countryCode', 'currency', 'effectiveFrom'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            countryCode: { type: 'string', minLength: 2, maxLength: 2 },
            city: { type: ['string', 'null'], maxLength: 80 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            effectiveFrom: { type: 'string', pattern: DATE },
            effectiveTo: { type: ['string', 'null'], pattern: DATE },
            isDefault: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const created = RateCard.create({
        id: c.ids.next<'RateCardId'>(),
        companyId: principal.companyId,
        name: request.body.name,
        countryCode: request.body.countryCode,
        city: request.body.city ?? null,
        currency: request.body.currency,
        effectiveFrom: new Date(`${request.body.effectiveFrom}T00:00:00Z`),
        effectiveTo: request.body.effectiveTo
          ? new Date(`${request.body.effectiveTo}T00:00:00Z`)
          : null,
        isDefault: request.body.isDefault ?? false,
      })
      if (created.isErr()) return sendError(reply, request.id, created.error)

      if (!(await cards.create(created.value))) {
        return reply
          .status(409)
          .send(
            problem(
              'RATE_CARD_NAME_TAKEN',
              'A rate card with this name already exists',
              409,
              request.id,
            ),
          )
      }
      return reply.status(201).send({ id: created.value.id, status: created.value.status })
    },
  )

  app.put<{
    Params: { cardId: string }
    Body: {
      items: {
        materialId?: string | null
        workItemCode: string
        descriptionEn: string
        descriptionAr: string
        uom: (typeof UNIT_OF_MEASURE_CODES)[number]
        materialRate?: string
        labourRate?: string
        equipmentRate?: string
        productivityPerDay?: string | null
      }[]
    }
  }>(
    '/api/v1/rate-cards/:cardId/items',
    {
      preHandler: [authenticate(c), requirePermission('boq.update')],
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: {
                type: 'object',
                required: ['workItemCode', 'descriptionEn', 'descriptionAr', 'uom'],
                additionalProperties: false,
                properties: {
                  materialId: { type: ['string', 'null'], maxLength: 36 },
                  workItemCode: { type: 'string', minLength: 2, maxLength: 64 },
                  descriptionEn: { type: 'string', minLength: 1, maxLength: 255 },
                  descriptionAr: { type: 'string', minLength: 1, maxLength: 255 },
                  uom: { enum: [...UNIT_OF_MEASURE_CODES] },
                  materialRate: { type: 'string', pattern: RATE },
                  labourRate: { type: 'string', pattern: RATE },
                  equipmentRate: { type: 'string', pattern: RATE },
                  productivityPerDay: { type: ['string', 'null'], pattern: RATE },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const card = await cards.findById(request.params.cardId as RateCardId)
      if (!card) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = card.replaceItems(
        request.body.items.map((item) => ({
          materialId: item.materialId ?? null,
          workItemCode: item.workItemCode,
          descriptionEn: item.descriptionEn,
          descriptionAr: item.descriptionAr,
          uom: item.uom,
          materialRate: item.materialRate ?? '0',
          labourRate: item.labourRate ?? '0',
          equipmentRate: item.equipmentRate ?? '0',
          productivityPerDay: item.productivityPerDay ?? null,
        })),
        () => c.ids.next(),
      )
      if (result.isErr()) return sendError(reply, request.id, result.error)

      await cards.save(card)
      return { id: card.id, itemCount: card.items.length }
    },
  )

  app.post<{ Params: { cardId: string } }>(
    '/api/v1/rate-cards/:cardId/activate',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request, reply) => {
      const card = await cards.findById(request.params.cardId as RateCardId)
      if (!card) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = card.activate()
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await cards.save(card)
      return { id: card.id, status: card.status }
    },
  )

  app.post<{ Params: { cardId: string } }>(
    '/api/v1/rate-cards/:cardId/archive',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request, reply) => {
      const card = await cards.findById(request.params.cardId as RateCardId)
      if (!card) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = card.archive()
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await cards.save(card)
      return { id: card.id, status: card.status }
    },
  )

  /** The regional starter — one call, idempotent, the tenant's to keep. */
  app.post(
    '/api/v1/rate-cards/seed-regional',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request) => {
      const principal = principalOf(request)
      return seedStarterRateCard(db, principal.companyId, c.ids)
    },
  )
}
