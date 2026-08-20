import type { FastifyInstance } from 'fastify'
import type { DomainError, InvoiceId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { UNIT_OF_MEASURE_CODES } from '@buildflow/catalogue'
import {
  Invoice,
  InvoiceQueries,
  PrismaInvoiceRepository,
  SupplierQueries,
} from '@buildflow/procurement'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Invoices, payments and cost allocation. Phase 3 sprint 7. docs/04 §2.9
 *
 * Totals are derived server-side from the lines and never accepted from the
 * client; allocations must sum to the total exactly; a wrong invoice is voided
 * with a reason, never deleted. The permissions mirror the money flow:
 * invoice.create books it, invoice.record_payment settles it, invoice.void
 * kills it, invoice.allocate attributes it.
 */
export function registerInvoiceRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const invoices = new PrismaInvoiceRepository(db)
  const queries = new InvoiceQueries(db)
  const suppliers = new SupplierQueries(db)

  const DECIMAL = '^\\d{1,14}(\\.\\d{1,4})?$'
  const RATE = '^\\d{1,3}(\\.\\d{1,4})?$'

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }

  app.get<{ Querystring: { paymentStatus?: string; supplierId?: string } }>(
    '/api/v1/invoices',
    {
      preHandler: [authenticate(c), requirePermission('invoice.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            paymentStatus: { enum: ['unpaid', 'partially_paid', 'paid', 'void'] },
            supplierId: { type: 'string', minLength: 36, maxLength: 36 },
          },
        },
      },
    },
    async (request) => ({
      data: await queries.list({
        ...(request.query.paymentStatus ? { paymentStatus: request.query.paymentStatus } : {}),
        ...(request.query.supplierId ? { supplierId: request.query.supplierId } : {}),
      }),
    }),
  )

  app.get<{ Params: { invoiceId: string } }>(
    '/api/v1/invoices/:invoiceId',
    { preHandler: [authenticate(c), requirePermission('invoice.view')] },
    async (request, reply) => {
      const invoice = await invoices.findById(request.params.invoiceId as InvoiceId)
      if (!invoice) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      return invoice.toSnapshot()
    },
  )

  app.post<{
    Body: {
      supplierId: string
      poId?: string | null
      invoiceNumber: string
      invoiceDate: string
      dueDate?: string | null
      taxRate?: string
      currency: string
      notes?: string | null
      lines: {
        materialId?: string | null
        description: string
        quantity: string
        uom: (typeof UNIT_OF_MEASURE_CODES)[number]
        unitPrice: string
      }[]
    }
  }>(
    '/api/v1/invoices',
    {
      preHandler: [authenticate(c), requirePermission('invoice.create')],
      schema: {
        body: {
          type: 'object',
          required: ['supplierId', 'invoiceNumber', 'invoiceDate', 'currency', 'lines'],
          additionalProperties: false,
          properties: {
            supplierId: { type: 'string', minLength: 36, maxLength: 36 },
            poId: { type: ['string', 'null'], maxLength: 36 },
            invoiceNumber: { type: 'string', minLength: 1, maxLength: 64 },
            invoiceDate: { type: 'string', format: 'date-time' },
            dueDate: { type: ['string', 'null'], format: 'date-time' },
            taxRate: { type: 'string', pattern: RATE },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            notes: { type: ['string', 'null'], maxLength: 500 },
            lines: {
              type: 'array',
              minItems: 1,
              maxItems: 200,
              items: {
                type: 'object',
                required: ['description', 'quantity', 'uom', 'unitPrice'],
                additionalProperties: false,
                properties: {
                  materialId: { type: ['string', 'null'], maxLength: 36 },
                  description: { type: 'string', minLength: 1, maxLength: 255 },
                  quantity: { type: 'string', pattern: DECIMAL },
                  uom: { enum: [...UNIT_OF_MEASURE_CODES] },
                  unitPrice: { type: 'string', pattern: DECIMAL },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)

      if (!(await suppliers.exists(request.body.supplierId))) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      // Same supplier re-sending the same number is the duplicate worth
      // catching — usually the same PDF booked twice.
      if (await invoices.numberExists(request.body.supplierId, request.body.invoiceNumber)) {
        return reply
          .status(409)
          .send(
            problem(
              'INVOICE_NUMBER_TAKEN',
              'This supplier already has an invoice with that number',
              409,
              request.id,
            ),
          )
      }

      const created = Invoice.create({
        id: c.ids.next<'InvoiceId'>(),
        companyId: principal.companyId,
        supplierId: request.body.supplierId,
        poId: request.body.poId ?? null,
        invoiceNumber: request.body.invoiceNumber,
        invoiceDate: new Date(request.body.invoiceDate),
        dueDate: request.body.dueDate ? new Date(request.body.dueDate) : null,
        taxRate: request.body.taxRate ?? '0',
        currency: request.body.currency,
        notes: request.body.notes ?? null,
        lines: request.body.lines.map((line) => ({
          id: c.ids.next(),
          materialId: line.materialId ?? null,
          description: line.description,
          quantity: line.quantity,
          uom: line.uom,
          unitPrice: line.unitPrice,
        })),
      })
      if (created.isErr()) return sendError(reply, request.id, created.error)

      await invoices.create(created.value)
      const snapshot = created.value.toSnapshot()
      return reply.status(201).send({
        id: snapshot.id,
        subtotal: snapshot.subtotal,
        taxAmount: snapshot.taxAmount,
        total: snapshot.total,
      })
    },
  )

  app.post<{ Params: { invoiceId: string }; Body: { amount: string; method: string } }>(
    '/api/v1/invoices/:invoiceId/payments',
    {
      preHandler: [authenticate(c), requirePermission('invoice.record_payment')],
      schema: {
        body: {
          type: 'object',
          required: ['amount', 'method'],
          additionalProperties: false,
          properties: {
            amount: { type: 'string', pattern: DECIMAL },
            method: { enum: ['cash', 'bank_transfer', 'cheque', 'card'] },
          },
        },
      },
    },
    async (request, reply) => {
      const invoice = await invoices.findById(request.params.invoiceId as InvoiceId)
      if (!invoice) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = invoice.recordPayment(request.body.amount, request.body.method, c.clock.now())
      if (result.isErr()) return sendError(reply, request.id, result.error)

      await invoices.save(invoice)
      return {
        id: invoice.id,
        paymentStatus: invoice.paymentStatus,
        paidAmount: invoice.paidAmount,
      }
    },
  )

  app.post<{ Params: { invoiceId: string }; Body: { reason: string } }>(
    '/api/v1/invoices/:invoiceId/void',
    {
      preHandler: [authenticate(c), requirePermission('invoice.void')],
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const invoice = await invoices.findById(request.params.invoiceId as InvoiceId)
      if (!invoice) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = invoice.void(request.body.reason)
      if (result.isErr()) return sendError(reply, request.id, result.error)

      await invoices.save(invoice)
      return { id: invoice.id, paymentStatus: invoice.paymentStatus }
    },
  )

  /**
   * Replaces the allocation set. Percentages OR exact amounts — one of them,
   * not both: two sources of the same truth is how they disagree.
   */
  app.put<{
    Params: { invoiceId: string }
    Body: {
      byPercentage?: { unitId: string; unitStageId?: string | null; percentage: string }[]
      byAmount?: { unitId: string; unitStageId?: string | null; amount: string }[]
    }
  }>(
    '/api/v1/invoices/:invoiceId/allocations',
    {
      preHandler: [authenticate(c), requirePermission('invoice.allocate')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            byPercentage: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['unitId', 'percentage'],
                additionalProperties: false,
                properties: {
                  unitId: { type: 'string', minLength: 36, maxLength: 36 },
                  unitStageId: { type: ['string', 'null'], maxLength: 36 },
                  percentage: { type: 'string', pattern: RATE },
                },
              },
            },
            byAmount: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['unitId', 'amount'],
                additionalProperties: false,
                properties: {
                  unitId: { type: 'string', minLength: 36, maxLength: 36 },
                  unitStageId: { type: ['string', 'null'], maxLength: 36 },
                  amount: { type: 'string', pattern: DECIMAL },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const hasPercentage = request.body.byPercentage !== undefined
      const hasAmount = request.body.byAmount !== undefined
      if (hasPercentage === hasAmount) {
        return reply
          .status(400)
          .send(
            problem(
              'ALLOCATION_MODE_AMBIGUOUS',
              'Provide byPercentage or byAmount — exactly one',
              400,
              request.id,
            ),
          )
      }

      const invoice = await invoices.findById(request.params.invoiceId as InvoiceId)
      if (!invoice) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      const byPercentage = request.body.byPercentage
      const byAmount = request.body.byAmount
      const result = byPercentage
        ? invoice.allocateByPercentages(
            byPercentage.map((entry) => ({
              unitId: entry.unitId,
              unitStageId: entry.unitStageId ?? null,
              percentage: entry.percentage,
            })),
            principal.userId,
            c.clock.now(),
            () => c.ids.next(),
          )
        : invoice.allocateByAmounts(
            (byAmount ?? []).map((entry) => ({
              unitId: entry.unitId,
              unitStageId: entry.unitStageId ?? null,
              amount: entry.amount,
            })),
            principal.userId,
            c.clock.now(),
            () => c.ids.next(),
          )
      if (result.isErr()) return sendError(reply, request.id, result.error)

      await invoices.save(invoice)
      return { id: invoice.id, allocations: invoice.allocations }
    },
  )

  /** Actual attributed cost per unit — the profitability report's numerator. */
  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/allocated-costs',
    { preHandler: [authenticate(c), requirePermission('cost.view')] },
    async (request) => ({ data: await queries.allocatedCostForUnit(request.params.unitId) }),
  )
}
