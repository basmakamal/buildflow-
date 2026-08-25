import type { FastifyInstance } from 'fastify'
import type { BoqId, DomainError, QuotationId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  PrismaBoqRepository,
  PrismaQuotationRepository,
  Quotation,
  QuotationQueries,
  buildQuotationDocument,
  type QuotationLanguage,
} from '@buildflow/estimation'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Quotations over HTTP. Phase 4 sprint 7. docs/04 §2.7
 *
 * Derived from an APPROVED BOQ — a price quoted from a draft is a price
 * nobody stands behind. The money is computed once at creation and frozen;
 * everything after send is tracking. The document endpoint returns the
 * bilingual render model, in either language regardless of which one was
 * sent: the contractor reads the English while the client holds the Arabic.
 */
export function registerQuotationRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const quotations = new PrismaQuotationRepository(db)
  const queries = new QuotationQueries(db)
  const boqs = new PrismaBoqRepository(db)

  const PERCENT = '^\\d{1,3}(\\.\\d{1,2})?$'
  const DECIMAL = '^\\d{1,14}(\\.\\d{1,4})?$'
  const DATE = '^\\d{4}-\\d{2}-\\d{2}$'

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }
  const notFound = (reply: Replyish, requestId: unknown) =>
    reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, requestId))

  app.get<{ Querystring: { unitId?: string; status?: string } }>(
    '/api/v1/quotations',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            unitId: { type: 'string', minLength: 36, maxLength: 36 },
            status: { enum: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'] },
          },
        },
      },
    },
    async (request) => ({
      data: await queries.list({
        ...(request.query.unitId ? { unitId: request.query.unitId } : {}),
        ...(request.query.status ? { status: request.query.status } : {}),
      }),
    }),
  )

  app.get<{ Params: { quotationId: string } }>(
    '/api/v1/quotations/:quotationId',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      const quotation = await quotations.findById(request.params.quotationId as QuotationId)
      if (!quotation) return notFound(reply, request.id)
      return quotation.toSnapshot()
    },
  )

  /** The bilingual render model a PDF writer consumes. docs/12 §RTL */
  app.get<{ Params: { quotationId: string }; Querystring: { lang?: QuotationLanguage } }>(
    '/api/v1/quotations/:quotationId/document',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { lang: { enum: ['ar', 'en'] } },
        },
      },
    },
    async (request, reply) => {
      const quotation = await quotations.findById(request.params.quotationId as QuotationId)
      if (!quotation) return notFound(reply, request.id)

      const boq = await boqs.findById(quotation.boqId as BoqId)
      if (!boq) return notFound(reply, request.id)

      const snapshot = quotation.toSnapshot()
      return buildQuotationDocument(
        snapshot,
        boq.toSnapshot(),
        boq.unitId,
        request.query.lang ?? snapshot.language,
      )
    },
  )

  app.post<{
    Body: {
      boqId: string
      validUntil: string
      markupPercentage?: string
      discountAmount?: string
      taxPercentage?: string
      language?: QuotationLanguage
      clientId?: string | null
      notes?: string | null
    }
  }>(
    '/api/v1/quotations',
    {
      preHandler: [authenticate(c), requirePermission('boq.export')],
      schema: {
        body: {
          type: 'object',
          required: ['boqId', 'validUntil'],
          additionalProperties: false,
          properties: {
            boqId: { type: 'string', minLength: 36, maxLength: 36 },
            validUntil: { type: 'string', pattern: DATE },
            markupPercentage: { type: 'string', pattern: PERCENT },
            discountAmount: { type: 'string', pattern: DECIMAL },
            taxPercentage: { type: 'string', pattern: PERCENT },
            language: { enum: ['ar', 'en'] },
            clientId: { type: ['string', 'null'], maxLength: 36 },
            notes: { type: ['string', 'null'], maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const boq = await boqs.findById(request.body.boqId as BoqId)
      if (!boq) return notFound(reply, request.id)

      // A price quoted from a draft is a price nobody stands behind, and one
      // quoted from a superseded version is last month's answer.
      if (boq.status !== 'approved') {
        return reply
          .status(400)
          .send(
            problem(
              'BOQ_NOT_APPROVED',
              'A quotation is derived from an approved BOQ',
              400,
              request.id,
            ),
          )
      }

      const snapshot = boq.toSnapshot()
      const created = Quotation.create({
        id: c.ids.next<'QuotationId'>(),
        companyId: principal.companyId,
        boqId: String(boq.id),
        unitId: boq.unitId,
        clientId: request.body.clientId ?? null,
        quotationNumber: await quotations.nextNumber(),
        basis: snapshot.preTaxTotal,
        currency: snapshot.currency,
        validUntil: new Date(`${request.body.validUntil}T00:00:00Z`),
        markupPercentage: request.body.markupPercentage ?? '0',
        discountAmount: request.body.discountAmount ?? '0',
        taxPercentage: request.body.taxPercentage ?? '0',
        language: request.body.language ?? 'ar',
        notes: request.body.notes ?? null,
      })
      if (created.isErr()) return sendError(reply, request.id, created.error)

      if (!(await quotations.create(created.value))) {
        return reply
          .status(409)
          .send(
            problem(
              'QUOTATION_NUMBER_TAKEN',
              'That quotation number was just used — retry',
              409,
              request.id,
            ),
          )
      }

      const result = created.value.toSnapshot()
      return reply.status(201).send({
        id: result.id,
        quotationNumber: result.quotationNumber,
        status: result.status,
        basisAmount: result.basisAmount,
        markupAmount: result.markupAmount,
        netAmount: result.netAmount,
        taxAmount: result.taxAmount,
        totalAmount: result.totalAmount,
        currency: result.currency,
      })
    },
  )

  app.post<{ Params: { quotationId: string }; Body: { documentId?: string | null } }>(
    '/api/v1/quotations/:quotationId/send',
    {
      preHandler: [authenticate(c), requirePermission('boq.export')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { documentId: { type: ['string', 'null'], maxLength: 36 } },
        },
      },
    },
    async (request, reply) => {
      const quotation = await quotations.findById(request.params.quotationId as QuotationId)
      if (!quotation) return notFound(reply, request.id)
      const result = quotation.send(c.clock.now(), request.body.documentId ?? null)
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await quotations.save(quotation)
      return { id: quotation.id, status: quotation.status, sentAt: quotation.sentAt }
    },
  )

  /**
   * Tracking transitions. `viewed` is recorded by whatever surface the client
   * opens the document on; accept/reject are the answer. All refuse once the
   * offer has expired — an expired price is a historical fact, not a choice.
   */
  const track = (
    path: 'view' | 'accept' | 'reject' | 'expire',
    permission: 'boq.view' | 'boq.export',
    act: (quotation: Quotation, at: Date) => ReturnType<Quotation['accept']>,
  ) => {
    app.post<{ Params: { quotationId: string } }>(
      `/api/v1/quotations/:quotationId/${path}`,
      { preHandler: [authenticate(c), requirePermission(permission)] },
      async (request, reply) => {
        const quotation = await quotations.findById(request.params.quotationId as QuotationId)
        if (!quotation) return notFound(reply, request.id)
        const result = act(quotation, c.clock.now())
        if (result.isErr()) return sendError(reply, request.id, result.error)
        await quotations.save(quotation)
        const snapshot = quotation.toSnapshot()
        return {
          id: snapshot.id,
          status: snapshot.status,
          viewedAt: snapshot.viewedAt,
          respondedAt: snapshot.respondedAt,
        }
      },
    )
  }
  track('view', 'boq.view', (quotation, at) => quotation.markViewed(at))
  track('accept', 'boq.export', (quotation, at) => quotation.accept(at))
  track('reject', 'boq.export', (quotation, at) => quotation.reject(at))
  track('expire', 'boq.export', (quotation, at) => quotation.expire(at))
}
