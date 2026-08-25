import type { FastifyInstance } from 'fastify'
import type { DomainError, PackageId, RateCardId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { isRoomType } from '@buildflow/project'
import {
  EstimationRuleRepository,
  FinishingPackage,
  PACKAGE_ELEMENTS,
  PACKAGE_TIERS,
  PackageQueries,
  PrismaBoqRepository,
  PrismaPackageRepository,
  PrismaRateCardRepository,
  RateCardQueries,
  RoomFactsQueries,
  buildBoq,
  estimatePackage,
  type EstimationRule,
  type PackageEstimate,
  type RateItem,
} from '@buildflow/estimation'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Finishing packages over HTTP. Phase 4 sprint 6. docs/04 §2.6
 *
 * A package is the recipe; applying it to a unit is what turns 14 rooms into
 * 140 BOQ lines, each carrying its formula. The comparison endpoint runs the
 * SAME generation as a dry run, so the three tiers a client is shown and the
 * BOQ the seller then generates come from one code path and cannot drift.
 */
export function registerPackageRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const packages = new PrismaPackageRepository(db)
  const queries = new PackageQueries(db)
  const rooms = new RoomFactsQueries(db)
  const rules = new EstimationRuleRepository(db)
  const cards = new PrismaRateCardRepository(db)
  const cardQueries = new RateCardQueries(db)
  const boqs = new PrismaBoqRepository(db)

  const DECIMAL = '^\\d{1,14}(\\.\\d{1,4})?$'
  const PERCENT = '^\\d{1,3}(\\.\\d{1,2})?$'
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

  /** The catalogue and card a generation run reads, loaded once per request. */
  const pricingContext = async (
    companyId: Parameters<typeof rules.effectiveForCompany>[0],
    rateCardId: string,
  ): Promise<{ rules: Map<string, EstimationRule>; rateItems: Map<string, RateItem> } | null> => {
    const card = await cards.findById(rateCardId as RateCardId)
    if (!card) return null
    const catalogue = await rules.effectiveForCompany(companyId)
    return {
      rules: new Map(catalogue.map((rule) => [rule.code, rule])),
      rateItems: new Map(card.items.map((item) => [item.workItemCode, item])),
    }
  }

  app.get<{ Querystring: { status?: 'draft' | 'published' | 'archived' } }>(
    '/api/v1/packages',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { status: { enum: ['draft', 'published', 'archived'] } },
        },
      },
    },
    async (request) => ({ data: await queries.list(request.query.status) }),
  )

  app.get<{ Params: { packageId: string } }>(
    '/api/v1/packages/:packageId',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      const pkg = await packages.findById(request.params.packageId as PackageId)
      if (!pkg) return notFound(reply, request.id)
      return pkg.toSnapshot()
    },
  )

  app.post<{
    Body: {
      code: string
      nameEn: string
      nameAr: string
      tier: (typeof PACKAGE_TIERS)[number]
      currency: string
      descriptionEn?: string | null
      descriptionAr?: string | null
      indicativePricePerSqm?: string | null
    }
  }>(
    '/api/v1/packages',
    {
      preHandler: [authenticate(c), requirePermission('boq.update')],
      schema: {
        body: {
          type: 'object',
          required: ['code', 'nameEn', 'nameAr', 'tier', 'currency'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 2, maxLength: 64 },
            nameEn: { type: 'string', minLength: 1, maxLength: 160 },
            nameAr: { type: 'string', minLength: 1, maxLength: 160 },
            tier: { enum: [...PACKAGE_TIERS] },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            descriptionEn: { type: ['string', 'null'], maxLength: 1000 },
            descriptionAr: { type: ['string', 'null'], maxLength: 1000 },
            indicativePricePerSqm: { type: ['string', 'null'], pattern: DECIMAL },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const created = FinishingPackage.create({
        id: c.ids.next<'PackageId'>(),
        companyId: principal.companyId,
        code: request.body.code,
        versionNumber: await packages.nextVersionNumber(request.body.code),
        nameEn: request.body.nameEn,
        nameAr: request.body.nameAr,
        tier: request.body.tier,
        descriptionEn: request.body.descriptionEn ?? null,
        descriptionAr: request.body.descriptionAr ?? null,
        currency: request.body.currency,
        indicativePricePerSqm: request.body.indicativePricePerSqm ?? null,
      })
      if (created.isErr()) return sendError(reply, request.id, created.error)

      if (!(await packages.create(created.value))) {
        return reply
          .status(409)
          .send(
            problem(
              'PACKAGE_VERSION_TAKEN',
              'That package version already exists',
              409,
              request.id,
            ),
          )
      }
      return reply.status(201).send({
        id: created.value.id,
        code: created.value.code,
        versionNumber: created.value.versionNumber,
        status: created.value.status,
      })
    },
  )

  app.put<{
    Params: { packageId: string }
    Body: {
      items: {
        roomTypeCode?: string | null
        element: (typeof PACKAGE_ELEMENTS)[number]
        workItemCode: string
        materialId?: string | null
        specTextEn?: string | null
        specTextAr?: string | null
        ruleCode?: string | null
        ruleInputs?: Record<string, string> | null
        fixedQuantity?: string | null
        isOptional?: boolean
        upgradePriceDelta?: string | null
      }[]
    }
  }>(
    '/api/v1/packages/:packageId/items',
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
              maxItems: 400,
              items: {
                type: 'object',
                required: ['element', 'workItemCode'],
                additionalProperties: false,
                properties: {
                  roomTypeCode: { type: ['string', 'null'], maxLength: 40 },
                  element: { enum: [...PACKAGE_ELEMENTS] },
                  workItemCode: { type: 'string', minLength: 2, maxLength: 64 },
                  materialId: { type: ['string', 'null'], maxLength: 36 },
                  specTextEn: { type: ['string', 'null'], maxLength: 255 },
                  specTextAr: { type: ['string', 'null'], maxLength: 255 },
                  ruleCode: { type: ['string', 'null'], maxLength: 64 },
                  ruleInputs: {
                    type: ['object', 'null'],
                    maxProperties: 20,
                    additionalProperties: { type: 'string', pattern: DECIMAL },
                  },
                  fixedQuantity: { type: ['string', 'null'], pattern: DECIMAL },
                  isOptional: { type: 'boolean' },
                  upgradePriceDelta: { type: ['string', 'null'], pattern: DECIMAL },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const pkg = await packages.findById(request.params.packageId as PackageId)
      if (!pkg) return notFound(reply, request.id)

      const result = pkg.replaceItems(
        request.body.items.map((item) => ({
          roomTypeCode: item.roomTypeCode ?? null,
          element: item.element,
          materialId: item.materialId ?? null,
          specTextEn: item.specTextEn ?? null,
          specTextAr: item.specTextAr ?? null,
          ruleCode: item.ruleCode ?? null,
          ruleInputs: item.ruleInputs ?? null,
          fixedQuantity: item.fixedQuantity ?? null,
          workItemCode: item.workItemCode,
          isOptional: item.isOptional ?? false,
          upgradePriceDelta: item.upgradePriceDelta ?? null,
        })),
        isRoomType,
        () => c.ids.next(),
      )
      if (result.isErr()) return sendError(reply, request.id, result.error)

      await packages.save(pkg)
      return { id: pkg.id, itemCount: pkg.items.length }
    },
  )

  app.post<{ Params: { packageId: string } }>(
    '/api/v1/packages/:packageId/publish',
    { preHandler: [authenticate(c), requirePermission('boq.approve')] },
    async (request, reply) => {
      const pkg = await packages.findById(request.params.packageId as PackageId)
      if (!pkg) return notFound(reply, request.id)
      const result = pkg.publish(c.clock.now())
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await packages.save(pkg)
      return { id: pkg.id, status: pkg.status }
    },
  )

  app.post<{ Params: { packageId: string } }>(
    '/api/v1/packages/:packageId/archive',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request, reply) => {
      const pkg = await packages.findById(request.params.packageId as PackageId)
      if (!pkg) return notFound(reply, request.id)
      const result = pkg.archive()
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await packages.save(pkg)
      return { id: pkg.id, status: pkg.status }
    },
  )

  app.post<{ Params: { packageId: string } }>(
    '/api/v1/packages/:packageId/versions',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request, reply) => {
      const pkg = await packages.findById(request.params.packageId as PackageId)
      if (!pkg) return notFound(reply, request.id)

      const next = pkg.nextVersion(c.ids.next<'PackageId'>(), () => c.ids.next())
      if (next.isErr()) return sendError(reply, request.id, next.error)

      if (!(await packages.create(next.value))) {
        return reply
          .status(409)
          .send(
            problem(
              'PACKAGE_VERSION_TAKEN',
              'That package version already exists',
              409,
              request.id,
            ),
          )
      }
      return reply.status(201).send({
        id: next.value.id,
        versionNumber: next.value.versionNumber,
        status: next.value.status,
      })
    },
  )

  /**
   * The comparison view — three tiers against THIS unit's actual rooms, which
   * is the number a client can act on, not an abstract per-m² brochure figure.
   */
  app.post<{
    Params: { unitId: string }
    Body: {
      packageIds: string[]
      pricingDate: string
      city?: string
      overheadPercentage?: string
      profitPercentage?: string
      taxPercentage?: string
      includeOptional?: boolean
    }
  }>(
    '/api/v1/units/:unitId/package-comparison',
    {
      preHandler: [authenticate(c), requirePermission('boq.view')],
      schema: {
        body: {
          type: 'object',
          required: ['packageIds', 'pricingDate'],
          additionalProperties: false,
          properties: {
            packageIds: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: { type: 'string', minLength: 36, maxLength: 36 },
            },
            pricingDate: { type: 'string', pattern: DATE },
            city: { type: 'string', minLength: 1, maxLength: 80 },
            overheadPercentage: { type: 'string', pattern: PERCENT },
            profitPercentage: { type: 'string', pattern: PERCENT },
            taxPercentage: { type: 'string', pattern: PERCENT },
            includeOptional: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const unitId = request.params.unitId

      const unit = await rooms.unitFacts(unitId)
      if (!unit) return notFound(reply, request.id)
      const unitRooms = await rooms.forUnit(unitId)

      const pricingDate = new Date(`${request.body.pricingDate}T00:00:00Z`)
      const resolved = await cardQueries.resolve(pricingDate, request.body.city ?? null)
      if (!resolved) {
        return reply
          .status(404)
          .send(
            problem(
              'RATE_CARD_NONE_EFFECTIVE',
              'No active rate card covers this pricing date',
              404,
              request.id,
            ),
          )
      }
      const context = await pricingContext(principal.companyId, resolved.card.id)
      if (!context) return notFound(reply, request.id)

      const estimates: PackageEstimate[] = []
      for (const packageId of request.body.packageIds) {
        const pkg = await packages.findById(packageId as PackageId)
        if (!pkg) return notFound(reply, request.id)

        const estimate = estimatePackage(
          {
            companyId: principal.companyId,
            unitId,
            pkg,
            rooms: unitRooms,
            rules: context.rules,
            rateItems: context.rateItems,
            includeOptional: request.body.includeOptional ?? false,
            grossArea: unit.grossArea,
            rateCardId: resolved.card.id,
            pricingDate,
            currency: resolved.card.currency,
            overheadPercentage: request.body.overheadPercentage ?? '0',
            profitPercentage: request.body.profitPercentage ?? '0',
            taxPercentage: request.body.taxPercentage ?? '0',
          },
          c.ids,
        )
        if (estimate.isErr()) return sendError(reply, request.id, estimate.error)
        estimates.push(estimate.value)
      }

      return {
        unitId,
        grossArea: unit.grossArea,
        rateCard: { id: resolved.card.id, name: resolved.card.name },
        pricingDate: request.body.pricingDate,
        data: estimates,
      }
    },
  )

  /** Applying the package: rooms × items → a draft BOQ, formulas and all. */
  app.post<{
    Params: { unitId: string }
    Body: {
      packageId: string
      name?: string
      pricingDate: string
      city?: string
      overheadPercentage?: string
      profitPercentage?: string
      taxPercentage?: string
      includeOptional?: boolean
      notes?: string | null
    }
  }>(
    '/api/v1/units/:unitId/apply-package',
    {
      preHandler: [authenticate(c), requirePermission('boq.generate')],
      schema: {
        body: {
          type: 'object',
          required: ['packageId', 'pricingDate'],
          additionalProperties: false,
          properties: {
            packageId: { type: 'string', minLength: 36, maxLength: 36 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            pricingDate: { type: 'string', pattern: DATE },
            city: { type: 'string', minLength: 1, maxLength: 80 },
            overheadPercentage: { type: 'string', pattern: PERCENT },
            profitPercentage: { type: 'string', pattern: PERCENT },
            taxPercentage: { type: 'string', pattern: PERCENT },
            includeOptional: { type: 'boolean' },
            notes: { type: ['string', 'null'], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const unitId = request.params.unitId

      const unit = await rooms.unitFacts(unitId)
      if (!unit) return notFound(reply, request.id)
      const unitRooms = await rooms.forUnit(unitId)

      const pkg = await packages.findById(request.body.packageId as PackageId)
      if (!pkg) return notFound(reply, request.id)

      const pricingDate = new Date(`${request.body.pricingDate}T00:00:00Z`)
      const resolved = await cardQueries.resolve(pricingDate, request.body.city ?? null)
      if (!resolved) {
        return reply
          .status(404)
          .send(
            problem(
              'RATE_CARD_NONE_EFFECTIVE',
              'No active rate card covers this pricing date',
              404,
              request.id,
            ),
          )
      }
      const context = await pricingContext(principal.companyId, resolved.card.id)
      if (!context) return notFound(reply, request.id)

      const built = buildBoq(
        {
          companyId: principal.companyId,
          unitId,
          pkg,
          rooms: unitRooms,
          rules: context.rules,
          rateItems: context.rateItems,
          includeOptional: request.body.includeOptional ?? false,
          boqId: c.ids.next<'BoqId'>(),
          versionNumber: await boqs.nextVersionNumber(unitId),
          name: request.body.name ?? `${pkg.nameEn} · ${String(pkg.versionNumber)}`,
          rateCardId: resolved.card.id,
          pricingDate,
          currency: resolved.card.currency,
          overheadPercentage: request.body.overheadPercentage ?? '0',
          profitPercentage: request.body.profitPercentage ?? '0',
          taxPercentage: request.body.taxPercentage ?? '0',
          notes: request.body.notes ?? null,
        },
        c.ids,
      )
      if (built.isErr()) return sendError(reply, request.id, built.error)

      const snapshot = built.value.boq.toSnapshot()
      if (!(await boqs.create(built.value.boq))) {
        return reply
          .status(409)
          .send(
            problem(
              'BOQ_VERSION_CONFLICT',
              'Someone else created this version at the same time — reload and retry',
              409,
              request.id,
            ),
          )
      }

      return reply.status(201).send({
        boqId: snapshot.id,
        versionNumber: snapshot.versionNumber,
        packageId: snapshot.packageId,
        packageVersion: snapshot.packageVersion,
        sectionCount: snapshot.sections.length,
        lineCount: snapshot.lines.length,
        subtotal: snapshot.subtotal,
        grandTotal: snapshot.grandTotal,
        skipped: built.value.skipped,
      })
    },
  )
}
