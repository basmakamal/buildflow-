import type { FastifyInstance } from 'fastify'
import { type MaterialId, Quantity, type UnitOfMeasure } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  PrismaBalanceProjection,
  PrismaMaterialRepository,
  PrismaStockLedger,
  UNIT_OF_MEASURE_CODES,
  STOCK_MOVEMENT_TYPES,
  directionFor,
  reversalOf,
  validateQuantity,
  type StockDirection,
  type StockMovementType,
} from '@buildflow/catalogue'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * The stock ledger. Phase 3 sprints 3–4. docs/04 §stock_movements
 *
 * There is no PUT and no DELETE on a movement, by design: corrections are
 * reversal entries appended through the same POST. The ledger explains its own
 * mistakes; an edited one merely hides them.
 */
export function registerStockRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const ledger = new PrismaStockLedger(db)
  const projection = new PrismaBalanceProjection(db)
  const materials = new PrismaMaterialRepository(db)

  interface RecordBody {
    materialId: string
    unitId: string
    unitStageId?: string | null
    roomId?: string | null
    type: StockMovementType
    direction?: StockDirection
    quantity: string
    uom: UnitOfMeasure
    unitCost?: string | null
    totalCost?: string | null
    currency?: string | null
    occurredAt?: string
    clientEventId: string
    note?: string | null
  }

  app.post<{ Body: RecordBody }>(
    '/api/v1/stock-movements',
    {
      // record_consumption covers all site-side movements; receipts arrive
      // through purchase.receive to keep the segregation-of-duties line where
      // docs/11 draws it — the person consuming stock is not the person who
      // certifies its arrival.
      preHandler: [authenticate(c), requirePermission('material.record_consumption')],
      schema: {
        body: {
          type: 'object',
          required: ['materialId', 'unitId', 'type', 'quantity', 'uom', 'clientEventId'],
          additionalProperties: false,
          properties: {
            materialId: { type: 'string', minLength: 36, maxLength: 36 },
            unitId: { type: 'string', minLength: 36, maxLength: 36 },
            unitStageId: { type: ['string', 'null'], maxLength: 36 },
            roomId: { type: ['string', 'null'], maxLength: 36 },
            type: { enum: [...STOCK_MOVEMENT_TYPES] },
            direction: { enum: ['in', 'out'] },
            quantity: { type: 'string', pattern: '^\\d{1,14}(\\.\\d{1,4})?$' },
            uom: { enum: [...UNIT_OF_MEASURE_CODES] },
            unitCost: { type: ['string', 'null'], pattern: '^\\d{1,12}(\\.\\d{1,4})?$' },
            totalCost: { type: ['string', 'null'], pattern: '^\\d{1,14}(\\.\\d{1,4})?$' },
            currency: { type: ['string', 'null'], minLength: 3, maxLength: 3 },
            occurredAt: { type: 'string', format: 'date-time' },
            /// Client-generated idempotency key; retries with the same id are
            /// acknowledged, not re-applied.
            clientEventId: { type: 'string', minLength: 36, maxLength: 36 },
            note: { type: ['string', 'null'], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const body = request.body

      const material = await materials.findById(body.materialId as MaterialId)
      // 404, not 403: the id may belong to another tenant. docs/07 §12
      if (!material || !material.isActive) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      const direction = directionFor(body.type, body.direction)
      if (direction.isErr()) {
        return reply
          .status(400)
          .send(problem(direction.error.code, direction.error.message, 400, request.id))
      }

      const quantityCheck = validateQuantity(body.quantity)
      if (quantityCheck.isErr()) {
        return reply
          .status(400)
          .send(problem(quantityCheck.error.code, quantityCheck.error.message, 400, request.id))
      }

      // Convert into the material's base unit AT THE BOUNDARY. The ledger
      // stores one unit per material or its sums mean nothing.
      const supplied = Quantity.from(body.quantity, body.uom)
      if (supplied.isErr()) {
        return reply
          .status(400)
          .send(problem(supplied.error.code, supplied.error.message, 400, request.id))
      }
      const base = material.toBaseQuantity(supplied.value)
      if (base.isErr()) {
        return reply
          .status(statusFor(base.error))
          .send(problem(base.error.code, base.error.message, statusFor(base.error), request.id))
      }

      const outcome = await ledger.append({
        id: c.ids.next(),
        materialId: material.id,
        unitId: body.unitId,
        unitStageId: body.unitStageId ?? null,
        roomId: body.roomId ?? null,
        type: body.type,
        direction: direction.value,
        quantity: base.value.toDecimal(),
        uom: material.baseUom,
        unitCost: body.unitCost ?? null,
        totalCost: body.totalCost ?? null,
        currency: body.currency ?? null,
        referenceType: null,
        referenceId: null,
        reversalOfMovementId: null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        recordedBy: principal.userId,
        source: 'web',
        clientEventId: body.clientEventId,
        note: body.note ?? null,
      })

      if (!outcome.appended) {
        // The offline outbox retried. Acknowledge idempotently — 200, not 201,
        // and the ORIGINAL id, so the client can reconcile its queue.
        return reply.status(200).send({ id: outcome.existingId, duplicate: true })
      }

      await projection.recalculate(
        principal.companyId,
        body.unitId,
        body.unitStageId ?? null,
        material.id,
        material.baseUom,
        body.currency ?? material.currency,
        () => c.ids.next(),
      )

      return reply.status(201).send({
        duplicate: false,
        quantityInBaseUom: base.value.toDecimal(),
        uom: material.baseUom,
      })
    },
  )

  /**
   * Appends the correcting entry for one movement. Refused when the movement is
   * already reversed — reversing twice would overshoot in the other direction,
   * and the double-tap retry is exactly the request this guard sees most.
   */
  app.post<{ Params: { movementId: string }; Body: { clientEventId: string; note?: string } }>(
    '/api/v1/stock-movements/:movementId/reverse',
    {
      preHandler: [authenticate(c), requirePermission('material.adjust_stock')],
      schema: {
        body: {
          type: 'object',
          required: ['clientEventId'],
          additionalProperties: false,
          properties: {
            clientEventId: { type: 'string', minLength: 36, maxLength: 36 },
            note: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const original = await ledger.findById(request.params.movementId)
      if (!original) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }
      if (original.reversalOfMovementId !== null) {
        return reply
          .status(422)
          .send(
            problem(
              'STOCK_CANNOT_REVERSE_REVERSAL',
              'A reversal is corrected by re-recording the original movement, not by reversing it again',
              422,
              request.id,
            ),
          )
      }
      if (await ledger.isReversed(original.id)) {
        return reply
          .status(409)
          .send(
            problem('STOCK_ALREADY_REVERSED', 'That movement is already reversed', 409, request.id),
          )
      }

      const reversal = reversalOf(original)
      const outcome = await ledger.append({
        ...reversal,
        id: c.ids.next(),
        materialId: original.materialId,
        unitId: original.unitId,
        unitStageId: original.unitStageId,
        roomId: original.roomId,
        unitCost: original.unitCost,
        currency: original.currency,
        referenceType: 'reversal',
        referenceId: original.id,
        occurredAt: new Date(),
        recordedBy: principal.userId,
        source: 'web',
        clientEventId: request.body.clientEventId,
        note: request.body.note ?? null,
      })

      if (!outcome.appended) {
        return reply.status(200).send({ id: outcome.existingId, duplicate: true })
      }

      await projection.recalculate(
        principal.companyId,
        original.unitId,
        original.unitStageId,
        original.materialId,
        original.uom,
        original.currency,
        () => c.ids.next(),
      )
      return reply.status(201).send({ duplicate: false, reversed: original.id })
    },
  )

  app.get<{ Params: { unitId: string }; Querystring: { materialId?: string; limit?: string } }>(
    '/api/v1/units/:unitId/stock-movements',
    {
      preHandler: [authenticate(c), requirePermission('material.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            materialId: { type: 'string', minLength: 36, maxLength: 36 },
            limit: { type: 'string', pattern: '^\\d{1,3}$' },
          },
        },
      },
    },
    async (request) => ({
      data: await ledger.movements({
        unitId: request.params.unitId,
        ...(request.query.materialId ? { materialId: request.query.materialId } : {}),
        ...(request.query.limit ? { limit: Number(request.query.limit) } : {}),
      }),
    }),
  )

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/material-balances',
    { preHandler: [authenticate(c), requirePermission('material.view')] },
    async (request) => ({ data: await projection.balancesFor(request.params.unitId) }),
  )
}
