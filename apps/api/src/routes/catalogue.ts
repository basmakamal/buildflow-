import type { FastifyInstance } from 'fastify'
import { type MaterialId, Quantity, type UnitOfMeasure } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  CatalogueQueries,
  Material,
  PrismaMaterialRepository,
  UNIT_OF_MEASURE_CODES,
} from '@buildflow/catalogue'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Material catalogue. Phase 3 sprints 1–2, docs/04 §2.6
 *
 * The catalogue is the tenant's own: no global material rows, so every read
 * here is scoped by the tenant extension with no exception. Categories are
 * global vocabulary and readable by anyone who may see materials at all.
 */
export function registerCatalogueRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const materials = new PrismaMaterialRepository(db)
  const queries = new CatalogueQueries(db)

  app.get(
    '/api/v1/material-categories',
    { preHandler: [authenticate(c), requirePermission('material.view')] },
    async () => ({ data: await queries.categories() }),
  )

  app.get<{ Querystring: { categoryId?: string; search?: string; includeInactive?: string } }>(
    '/api/v1/materials',
    {
      preHandler: [authenticate(c), requirePermission('material.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            categoryId: { type: 'string', minLength: 36, maxLength: 36 },
            search: { type: 'string', maxLength: 120 },
            includeInactive: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
    },
    async (request) => ({
      data: await queries.materials({
        ...(request.query.categoryId ? { categoryId: request.query.categoryId } : {}),
        ...(request.query.search ? { search: request.query.search } : {}),
        includeInactive: request.query.includeInactive === 'true',
      }),
    }),
  )

  interface CreateBody {
    categoryId: string
    brandId?: string | null
    sku: string
    nameEn: string
    nameAr: string
    description?: string | null
    baseUom: UnitOfMeasure
    defaultCost?: string | null
    currency?: string | null
    wasteFactor?: string | null
    knowledgeCode?: string | null
    conversions?: { fromUom: UnitOfMeasure; toUom: UnitOfMeasure; factor: string }[]
  }

  app.post<{ Body: CreateBody }>(
    '/api/v1/materials',
    {
      preHandler: [authenticate(c), requirePermission('material.create')],
      schema: {
        body: {
          type: 'object',
          required: ['categoryId', 'sku', 'nameEn', 'nameAr', 'baseUom'],
          additionalProperties: false,
          properties: {
            categoryId: { type: 'string', minLength: 36, maxLength: 36 },
            brandId: { type: ['string', 'null'], maxLength: 36 },
            sku: { type: 'string', minLength: 2, maxLength: 64 },
            nameEn: { type: 'string', minLength: 1, maxLength: 200 },
            nameAr: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: ['string', 'null'], maxLength: 500 },
            baseUom: { enum: [...UNIT_OF_MEASURE_CODES] },
            // Decimals travel as strings. A JSON number would round a price at
            // the boundary before the domain ever validated it. docs/04 §1
            defaultCost: { type: ['string', 'null'], pattern: '^\\d{1,12}(\\.\\d{1,6})?$' },
            currency: { type: ['string', 'null'], minLength: 3, maxLength: 3 },
            wasteFactor: { type: ['string', 'null'], pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
            knowledgeCode: { type: ['string', 'null'], maxLength: 64 },
            conversions: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'object',
                required: ['fromUom', 'toUom', 'factor'],
                additionalProperties: false,
                properties: {
                  fromUom: { enum: [...UNIT_OF_MEASURE_CODES] },
                  toUom: { enum: [...UNIT_OF_MEASURE_CODES] },
                  factor: { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,6})?$' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)

      if (await materials.skuExists(request.body.sku)) {
        return reply
          .status(409)
          .send(problem('MATERIAL_SKU_TAKEN', 'That SKU is already in use', 409, request.id))
      }

      const created = Material.create({
        id: c.ids.next<'MaterialId'>(),
        companyId: principal.companyId,
        categoryId: request.body.categoryId,
        brandId: request.body.brandId ?? null,
        sku: request.body.sku,
        nameEn: request.body.nameEn,
        nameAr: request.body.nameAr,
        description: request.body.description ?? null,
        baseUom: request.body.baseUom,
        defaultCost: request.body.defaultCost ?? null,
        currency: request.body.currency ?? null,
        spec: null,
        wasteFactor: request.body.wasteFactor ?? null,
        knowledgeCode: request.body.knowledgeCode ?? null,
        ...(request.body.conversions ? { conversions: request.body.conversions } : {}),
      })

      if (created.isErr()) {
        return reply
          .status(statusFor(created.error))
          .send(
            problem(
              created.error.code,
              created.error.message,
              statusFor(created.error),
              request.id,
            ),
          )
      }

      const snapshot = created.value.toSnapshot()
      await materials.create(snapshot)
      return reply.status(201).send({ id: snapshot.id, sku: snapshot.sku })
    },
  )

  /**
   * Converts a quantity into a material's base unit.
   *
   * Exposed because it is the calculation every downstream consumer needs and
   * must not reimplement: a purchase order, a BOQ line and a consumption record
   * that each carry their own box→m² factor will disagree, and the disagreement
   * shows up as unexplained variance in the margin report.
   */
  app.post<{
    Params: { materialId: string }
    Body: { quantity: string; uom: UnitOfMeasure; applyWaste?: boolean }
  }>(
    '/api/v1/materials/:materialId/convert',
    {
      preHandler: [authenticate(c), requirePermission('material.view')],
      schema: {
        body: {
          type: 'object',
          required: ['quantity', 'uom'],
          additionalProperties: false,
          properties: {
            quantity: { type: 'string', pattern: '^\\d{1,12}(\\.\\d{1,4})?$' },
            uom: { enum: [...UNIT_OF_MEASURE_CODES] },
            applyWaste: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const material = await materials.findById(request.params.materialId as MaterialId)
      // 404 rather than 403: the id may belong to another tenant, and the
      // answer must be indistinguishable from "never existed". docs/07 §12
      if (!material) {
        return reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, request.id))
      }

      const quantity = Quantity.from(request.body.quantity, request.body.uom)
      if (quantity.isErr()) {
        return reply
          .status(400)
          .send(problem(quantity.error.code, quantity.error.message, 400, request.id))
      }

      const categories = await queries.categories()
      const categoryWaste =
        categories.find((category) => category.id === material.categoryId)?.defaultWasteFactor ??
        '0'

      const result =
        request.body.applyWaste === true
          ? material.purchaseQuantity(quantity.value, categoryWaste)
          : material.toBaseQuantity(quantity.value)

      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      return {
        materialId: material.id,
        sku: material.sku,
        input: { quantity: request.body.quantity, uom: request.body.uom },
        base: { quantity: result.value.toDecimal(), uom: result.value.uom },
        wasteApplied: request.body.applyWaste === true,
        wasteFactor:
          request.body.applyWaste === true ? (material.wasteFactor ?? categoryWaste) : null,
      }
    },
  )
}
