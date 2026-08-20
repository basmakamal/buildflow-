import type { FastifyInstance } from 'fastify'
import type { DomainError, PurchaseOrderId, PurchaseRequestId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { UNIT_OF_MEASURE_CODES } from '@buildflow/catalogue'
import {
  CatalogueStockPoster,
  PrismaPurchaseOrderRepository,
  PrismaPurchaseRequestRepository,
  PrismaReceiptWriter,
  PurchaseOrder,
  PurchaseRequest,
  ReceiveGoodsHandler,
  ReceiptQueries,
  SupplierQueries,
} from '@buildflow/procurement'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Procurement. Phase 3 sprints 5–6. docs/04 §2.9
 *
 * The permission split IS the control flow: purchase.create raises and submits,
 * purchase.approve releases (and the domain refuses self-approval on top),
 * purchase.receive books arrivals. One person holding all three is a tenant
 * configuration choice; the same person acting both sides of ONE request is
 * not, and never becomes one.
 */
export function registerProcurementRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const requests = new PrismaPurchaseRequestRepository(db)
  const orders = new PrismaPurchaseOrderRepository(db)
  const suppliers = new SupplierQueries(db)
  const receiptQueries = new ReceiptQueries(db)

  const DECIMAL = '^\\d{1,14}(\\.\\d{1,4})?$'

  // Structural rather than Fastify's generic FastifyReply: every route's reply
  // is a distinct instantiation, and their intersection collapses to `never`.
  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }

  // ── Suppliers ──────────────────────────────────────────────────────────────

  app.get(
    '/api/v1/suppliers',
    { preHandler: [authenticate(c), requirePermission('purchase.view')] },
    async () => ({ data: await suppliers.list() }),
  )

  app.post<{
    Body: {
      code: string
      nameEn: string
      nameAr: string
      contactPerson?: string | null
      mobile?: string | null
      email?: string | null
      city?: string | null
      taxNumber?: string | null
      paymentTermsDays?: number
    }
  }>(
    '/api/v1/suppliers',
    {
      preHandler: [authenticate(c), requirePermission('purchase.create')],
      schema: {
        body: {
          type: 'object',
          required: ['code', 'nameEn', 'nameAr'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 2, maxLength: 32, pattern: '^[A-Za-z0-9-]+$' },
            nameEn: { type: 'string', minLength: 1, maxLength: 200 },
            nameAr: { type: 'string', minLength: 1, maxLength: 200 },
            contactPerson: { type: ['string', 'null'], maxLength: 120 },
            mobile: { type: ['string', 'null'], maxLength: 20 },
            email: { type: ['string', 'null'], format: 'email', maxLength: 255 },
            city: { type: ['string', 'null'], maxLength: 80 },
            taxNumber: { type: ['string', 'null'], maxLength: 32 },
            paymentTermsDays: { type: 'integer', minimum: 0, maximum: 365 },
          },
        },
      },
    },
    async (request, reply) => {
      if (await suppliers.codeExists(request.body.code)) {
        return reply
          .status(409)
          .send(problem('SUPPLIER_CODE_TAKEN', 'That code is already in use', 409, request.id))
      }
      const id = c.ids.next()
      await db.supplier.create({
        data: {
          id,
          code: request.body.code,
          nameEn: request.body.nameEn,
          nameAr: request.body.nameAr,
          contactPerson: request.body.contactPerson ?? null,
          mobile: request.body.mobile ?? null,
          email: request.body.email ?? null,
          city: request.body.city ?? null,
          taxNumber: request.body.taxNumber ?? null,
          paymentTermsDays: request.body.paymentTermsDays ?? 0,
        } as never,
      })
      return reply.status(201).send({ id })
    },
  )

  // ── Purchase requests ──────────────────────────────────────────────────────

  app.post<{
    Body: {
      projectId: string
      unitId?: string | null
      unitStageId?: string | null
      requiredByDate?: string | null
      currency: string
      lines: {
        materialId: string
        description?: string | null
        quantity: string
        uom: (typeof UNIT_OF_MEASURE_CODES)[number]
        estimatedUnitPrice?: string | null
        note?: string | null
      }[]
    }
  }>(
    '/api/v1/purchase-requests',
    {
      preHandler: [authenticate(c), requirePermission('purchase.create')],
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'currency', 'lines'],
          additionalProperties: false,
          properties: {
            projectId: { type: 'string', minLength: 36, maxLength: 36 },
            unitId: { type: ['string', 'null'], maxLength: 36 },
            unitStageId: { type: ['string', 'null'], maxLength: 36 },
            requiredByDate: { type: ['string', 'null'], format: 'date-time' },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            lines: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['materialId', 'quantity', 'uom'],
                additionalProperties: false,
                properties: {
                  materialId: { type: 'string', minLength: 36, maxLength: 36 },
                  description: { type: ['string', 'null'], maxLength: 255 },
                  quantity: { type: 'string', pattern: DECIMAL },
                  uom: { enum: [...UNIT_OF_MEASURE_CODES] },
                  estimatedUnitPrice: { type: ['string', 'null'], pattern: DECIMAL },
                  note: { type: ['string', 'null'], maxLength: 255 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const created = PurchaseRequest.create({
        id: c.ids.next<'PurchaseRequestId'>(),
        companyId: principal.companyId,
        projectId: request.body.projectId,
        unitId: request.body.unitId ?? null,
        unitStageId: request.body.unitStageId ?? null,
        requestNumber: await requests.nextRequestNumber(),
        requestedBy: principal.userId,
        requestedAt: c.clock.now(),
        requiredByDate: request.body.requiredByDate ? new Date(request.body.requiredByDate) : null,
        currency: request.body.currency,
        lines: request.body.lines.map((line) => ({
          id: c.ids.next(),
          materialId: line.materialId,
          description: line.description ?? null,
          quantity: line.quantity,
          uom: line.uom,
          estimatedUnitPrice: line.estimatedUnitPrice ?? null,
          note: line.note ?? null,
        })),
      })
      if (created.isErr()) return sendError(reply, request.id, created.error)

      await requests.create(created.value)
      const snapshot = created.value.toSnapshot()
      return reply.status(201).send({
        id: snapshot.id,
        requestNumber: snapshot.requestNumber,
        totalEstimated: snapshot.totalEstimated,
      })
    },
  )

  /** submit / approve / reject / cancel share one transition shape. */
  for (const [action, permission] of [
    ['submit', 'purchase.create'],
    ['approve', 'purchase.approve'],
    ['reject', 'purchase.approve'],
    ['cancel', 'purchase.create'],
  ] as const) {
    app.post<{ Params: { requestId: string }; Body: { reason?: string } | undefined }>(
      `/api/v1/purchase-requests/:requestId/${action}`,
      {
        preHandler: [authenticate(c), requirePermission(permission)],
        schema: {
          body: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: { reason: { type: 'string', maxLength: 500 } },
          },
        },
      },
      async (request, reply) => {
        const principal = principalOf(request)
        const found = await requests.findById(request.params.requestId as PurchaseRequestId)
        if (!found) {
          return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
        }

        const result =
          action === 'submit'
            ? found.submit()
            : action === 'approve'
              ? found.approve(principal.userId, c.clock.now())
              : action === 'reject'
                ? found.reject(request.body?.reason ?? '')
                : found.cancel()

        if (result.isErr()) return sendError(reply, request.id, result.error)

        await requests.save(found)
        return { id: found.id, status: found.status }
      },
    )
  }

  /**
   * Converts an approved request into a draft purchase order. Prices come from
   * the CALLER, not the request: estimates were the engineer's guess, the PO is
   * the negotiated commitment, and conflating them is how estimates quietly
   * become prices nobody agreed.
   */
  app.post<{
    Params: { requestId: string }
    Body: {
      supplierId: string
      taxAmount?: string
      expectedDeliveryDate?: string | null
      terms?: string | null
      lines: { requestLineId: string; unitPrice: string }[]
    }
  }>(
    '/api/v1/purchase-requests/:requestId/convert',
    {
      preHandler: [authenticate(c), requirePermission('purchase.create')],
      schema: {
        body: {
          type: 'object',
          required: ['supplierId', 'lines'],
          additionalProperties: false,
          properties: {
            supplierId: { type: 'string', minLength: 36, maxLength: 36 },
            taxAmount: { type: 'string', pattern: DECIMAL },
            expectedDeliveryDate: { type: ['string', 'null'], format: 'date-time' },
            terms: { type: ['string', 'null'], maxLength: 500 },
            lines: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['requestLineId', 'unitPrice'],
                additionalProperties: false,
                properties: {
                  requestLineId: { type: 'string', minLength: 36, maxLength: 36 },
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
      const found = await requests.findById(request.params.requestId as PurchaseRequestId)
      if (!found) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      if (!(await suppliers.exists(request.body.supplierId))) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      // Every priced line must exist on the request — a PO line with no
      // requested ancestor is spend that skipped the approval.
      const orderLines = []
      for (const priced of request.body.lines) {
        const requestLine = found.lines.find((line) => line.id === priced.requestLineId)
        if (!requestLine) {
          return reply
            .status(400)
            .send(
              problem('CONVERT_UNKNOWN_LINE', 'That line is not on this request', 400, request.id),
            )
        }
        orderLines.push({
          id: c.ids.next(),
          materialId: requestLine.materialId,
          quantity: requestLine.quantity,
          uom: requestLine.uom,
          unitPrice: priced.unitPrice,
        })
      }

      const converted = found.markConverted()
      if (converted.isErr()) return sendError(reply, request.id, converted.error)

      const order = PurchaseOrder.create({
        id: c.ids.next<'PurchaseOrderId'>(),
        companyId: principal.companyId,
        requestId: found.id,
        supplierId: request.body.supplierId,
        poNumber: await orders.nextPoNumber(),
        expectedDeliveryDate: request.body.expectedDeliveryDate
          ? new Date(request.body.expectedDeliveryDate)
          : null,
        taxAmount: request.body.taxAmount ?? '0',
        currency: found.currency,
        terms: request.body.terms ?? null,
        lines: orderLines,
      })
      if (order.isErr()) return sendError(reply, request.id, order.error)

      await orders.create(order.value)
      await requests.save(found)

      const snapshot = order.value.toSnapshot()
      return reply.status(201).send({
        id: snapshot.id,
        poNumber: snapshot.poNumber,
        subtotal: snapshot.subtotal,
        total: snapshot.total,
      })
    },
  )

  // ── Purchase orders ────────────────────────────────────────────────────────

  app.post<{ Params: { poId: string } }>(
    '/api/v1/purchase-orders/:poId/issue',
    { preHandler: [authenticate(c), requirePermission('purchase.approve')] },
    async (request, reply) => {
      const order = await orders.findById(request.params.poId as PurchaseOrderId)
      if (!order) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      const result = order.issue(c.clock.now())
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await orders.save(order)
      return { id: order.id, status: order.status }
    },
  )

  /** The receipt: PO advances, document written, ledger posted — one command. */
  app.post<{
    Params: { poId: string }
    Body: {
      unitId: string
      clientEventId: string
      notes?: string | null
      lines: {
        poLineId: string
        quantity: string
        rejectedQuantity?: string
        rejectionReason?: string | null
      }[]
    }
  }>(
    '/api/v1/purchase-orders/:poId/receipts',
    {
      preHandler: [authenticate(c), requirePermission('purchase.receive')],
      schema: {
        body: {
          type: 'object',
          required: ['unitId', 'clientEventId', 'lines'],
          additionalProperties: false,
          properties: {
            unitId: { type: 'string', minLength: 36, maxLength: 36 },
            clientEventId: { type: 'string', minLength: 36, maxLength: 36 },
            notes: { type: ['string', 'null'], maxLength: 500 },
            lines: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['poLineId', 'quantity'],
                additionalProperties: false,
                properties: {
                  poLineId: { type: 'string', minLength: 36, maxLength: 36 },
                  quantity: { type: 'string', pattern: DECIMAL },
                  rejectedQuantity: { type: 'string', pattern: DECIMAL },
                  rejectionReason: { type: ['string', 'null'], maxLength: 255 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const handler = new ReceiveGoodsHandler(
        orders,
        new PrismaReceiptWriter(db),
        new CatalogueStockPoster(db, c.ids),
        c.ids,
      )

      const result = await handler.handle({
        poId: request.params.poId as PurchaseOrderId,
        unitId: request.body.unitId,
        receivedBy: principal.userId,
        receivedAt: c.clock.now(),
        notes: request.body.notes ?? null,
        clientEventId: request.body.clientEventId,
        lines: request.body.lines.map((line) => ({
          poLineId: line.poLineId,
          quantity: line.quantity,
          rejectedQuantity: line.rejectedQuantity ?? '0',
          rejectionReason: line.rejectionReason ?? null,
        })),
      })
      if (result.isErr()) return sendError(reply, request.id, result.error)

      return reply.status(result.value.duplicate ? 200 : 201).send(result.value)
    },
  )

  app.get<{ Params: { poId: string } }>(
    '/api/v1/purchase-orders/:poId',
    { preHandler: [authenticate(c), requirePermission('purchase.view')] },
    async (request, reply) => {
      const order = await orders.findById(request.params.poId as PurchaseOrderId)
      if (!order) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      return {
        ...order.toSnapshot(),
        receipts: await receiptQueries.forOrder(order.id),
      }
    },
  )
}
