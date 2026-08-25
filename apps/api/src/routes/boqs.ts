import type { FastifyInstance } from 'fastify'
import type { BoqId, DomainError, RateCardId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import { UNIT_OF_MEASURE_CODES } from '@buildflow/catalogue'
import { BudgetQueries } from '@buildflow/procurement'
import {
  Boq,
  BoqQueries,
  EstimationRuleRepository,
  PrismaBoqRepository,
  PrismaRateCardRepository,
  RateCardQueries,
  coversDate,
  diffBoqs,
  evaluateRule,
  type NewLineInput,
} from '@buildflow/estimation'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * The BOQ over HTTP. Phase 4 sprints 4–5. docs/02 §3.7, docs/04 §2.7
 *
 * Rates come from the BOQ's rate card, resolved once at creation by the
 * PRICING DATE; a rule-sourced line is evaluated server-side and lands with
 * its provenance; totals are derived in the aggregate and never accepted from
 * a client. Approval freezes the document; a new version supersedes the old
 * one only when IT is approved — there is never a moment without exactly one
 * authoritative approved BOQ. The permissions mirror the document's life:
 * boq.generate creates and versions, boq.update shapes the draft,
 * boq.override_line overrules a formula (dangerous-listed, reason required),
 * boq.approve signs.
 */
export function registerBoqRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const boqs = new PrismaBoqRepository(db)
  const queries = new BoqQueries(db)
  const cards = new PrismaRateCardRepository(db)
  const cardQueries = new RateCardQueries(db)
  const rules = new EstimationRuleRepository(db)
  const units = new BudgetQueries(db)

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

  const loadBoq = async (id: string) => boqs.findById(id as BoqId)

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/boqs',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      if (!(await units.unitCurrency(request.params.unitId))) return notFound(reply, request.id)
      return { data: await queries.listForUnit(request.params.unitId) }
    },
  )

  app.get<{ Params: { boqId: string } }>(
    '/api/v1/boqs/:boqId',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)
      return boq.toSnapshot()
    },
  )

  app.get<{ Params: { boqId: string; againstId: string } }>(
    '/api/v1/boqs/:boqId/diff/:againstId',
    { preHandler: [authenticate(c), requirePermission('boq.view')] },
    async (request, reply) => {
      const [to, from] = await Promise.all([
        loadBoq(request.params.boqId),
        loadBoq(request.params.againstId),
      ])
      if (!to || !from) return notFound(reply, request.id)
      if (to.unitId !== from.unitId) {
        return reply
          .status(400)
          .send(
            problem(
              'BOQ_DIFF_DIFFERENT_UNITS',
              'These BOQs quantify different units',
              400,
              request.id,
            ),
          )
      }
      return diffBoqs(from.toSnapshot(), to.toSnapshot())
    },
  )

  app.post<{
    Params: { unitId: string }
    Body: {
      name: string
      pricingDate: string
      rateCardId?: string
      city?: string
      finishingLevel?: 'economy' | 'standard' | 'premium' | 'luxury'
      overheadPercentage?: string
      profitPercentage?: string
      taxPercentage?: string
      notes?: string | null
    }
  }>(
    '/api/v1/units/:unitId/boqs',
    {
      preHandler: [authenticate(c), requirePermission('boq.generate')],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'pricingDate'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            pricingDate: { type: 'string', pattern: DATE },
            rateCardId: { type: 'string', minLength: 36, maxLength: 36 },
            city: { type: 'string', minLength: 1, maxLength: 80 },
            finishingLevel: { enum: ['economy', 'standard', 'premium', 'luxury'] },
            overheadPercentage: { type: 'string', pattern: PERCENT },
            profitPercentage: { type: 'string', pattern: PERCENT },
            taxPercentage: { type: 'string', pattern: PERCENT },
            notes: { type: ['string', 'null'], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const unitId = request.params.unitId
      if (!(await units.unitCurrency(unitId))) return notFound(reply, request.id)

      const pricingDate = new Date(`${request.body.pricingDate}T00:00:00Z`)

      // The rate card binds at creation, by the pricing date — never "now".
      let rateCardId: string
      let currency: string
      if (request.body.rateCardId) {
        const card = await cards.findById(request.body.rateCardId as RateCardId)
        if (!card) return notFound(reply, request.id)
        if (!coversDate(card.toSnapshot(), pricingDate)) {
          return reply
            .status(400)
            .send(
              problem(
                'RATE_CARD_NOT_EFFECTIVE',
                'This rate card does not cover the pricing date',
                400,
                request.id,
              ),
            )
        }
        rateCardId = String(card.id)
        currency = card.currency
      } else {
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
        rateCardId = resolved.card.id
        currency = resolved.card.currency
      }

      const created = Boq.create({
        id: c.ids.next<'BoqId'>(),
        companyId: principal.companyId,
        unitId,
        versionNumber: await boqs.nextVersionNumber(unitId),
        name: request.body.name,
        finishingLevel: request.body.finishingLevel ?? null,
        rateCardId,
        pricingDate,
        currency,
        overheadPercentage: request.body.overheadPercentage ?? '0',
        profitPercentage: request.body.profitPercentage ?? '0',
        taxPercentage: request.body.taxPercentage ?? '0',
        notes: request.body.notes ?? null,
        generatedBy: 'manual',
      })
      if (created.isErr()) return sendError(reply, request.id, created.error)

      if (!(await boqs.create(created.value))) {
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
      const snapshot = created.value.toSnapshot()
      return reply.status(201).send({
        id: snapshot.id,
        versionNumber: snapshot.versionNumber,
        status: snapshot.status,
        rateCardId: snapshot.rateCardId,
        currency: snapshot.currency,
      })
    },
  )

  app.post<{
    Params: { boqId: string }
    Body: {
      code: string
      titleEn: string
      titleAr: string
      stageTemplateId?: string | null
      sortOrder?: number
    }
  }>(
    '/api/v1/boqs/:boqId/sections',
    {
      preHandler: [authenticate(c), requirePermission('boq.update')],
      schema: {
        body: {
          type: 'object',
          required: ['code', 'titleEn', 'titleAr'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 1, maxLength: 32 },
            titleEn: { type: 'string', minLength: 1, maxLength: 160 },
            titleAr: { type: 'string', minLength: 1, maxLength: 160 },
            stageTemplateId: { type: ['string', 'null'], maxLength: 36 },
            sortOrder: { type: 'integer', minimum: 0, maximum: 32000 },
          },
        },
      },
    },
    async (request, reply) => {
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)

      const sectionId = c.ids.next()
      const result = boq.addSection({
        id: sectionId,
        stageTemplateId: request.body.stageTemplateId ?? null,
        code: request.body.code,
        titleEn: request.body.titleEn,
        titleAr: request.body.titleAr,
        sortOrder: request.body.sortOrder ?? boq.sections.length,
      })
      if (result.isErr()) return sendError(reply, request.id, result.error)

      await boqs.save(boq)
      return reply.status(201).send({ sectionId })
    },
  )

  app.post<{
    Params: { boqId: string }
    Body: {
      sectionId: string
      source: 'manual' | 'rule'
      workItemCode: string
      roomId?: string | null
      materialId?: string | null
      // manual lines:
      quantity?: string
      wasteFactor?: string
      descriptionEn?: string
      descriptionAr?: string
      uom?: (typeof UNIT_OF_MEASURE_CODES)[number]
      materialRate?: string
      labourRate?: string
      equipmentRate?: string
      // rule lines:
      ruleCode?: string
      inputs?: Record<string, string>
    }
  }>(
    '/api/v1/boqs/:boqId/lines',
    {
      preHandler: [authenticate(c), requirePermission('boq.update')],
      schema: {
        body: {
          type: 'object',
          required: ['sectionId', 'source', 'workItemCode'],
          additionalProperties: false,
          properties: {
            sectionId: { type: 'string', minLength: 36, maxLength: 36 },
            source: { enum: ['manual', 'rule'] },
            workItemCode: { type: 'string', minLength: 2, maxLength: 64 },
            roomId: { type: ['string', 'null'], maxLength: 36 },
            materialId: { type: ['string', 'null'], maxLength: 36 },
            quantity: { type: 'string', pattern: DECIMAL },
            wasteFactor: { type: 'string', pattern: PERCENT },
            descriptionEn: { type: 'string', minLength: 1, maxLength: 255 },
            descriptionAr: { type: 'string', minLength: 1, maxLength: 255 },
            uom: { enum: [...UNIT_OF_MEASURE_CODES] },
            materialRate: { type: 'string', pattern: DECIMAL },
            labourRate: { type: 'string', pattern: DECIMAL },
            equipmentRate: { type: 'string', pattern: DECIMAL },
            ruleCode: { type: 'string', minLength: 2, maxLength: 64 },
            inputs: {
              type: 'object',
              maxProperties: 20,
              additionalProperties: { type: 'string', pattern: DECIMAL },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)

      const card = await cards.findById(boq.rateCardId as RateCardId)
      if (!card) return notFound(reply, request.id)
      const cardItem = card.items.find((item) => item.workItemCode === request.body.workItemCode)

      let line: NewLineInput
      if (request.body.source === 'rule') {
        if (!request.body.ruleCode || !request.body.inputs) {
          return reply
            .status(400)
            .send(
              problem(
                'BOQ_RULE_LINE_NEEDS_RULE',
                'A rule line needs ruleCode and inputs',
                400,
                request.id,
              ),
            )
        }
        // A rule line prices from the card, or it does not price at all —
        // hand-typed rates on a rule quantity is two provenances on one line.
        if (!cardItem) {
          return reply
            .status(400)
            .send(
              problem(
                'BOQ_RATE_ITEM_MISSING',
                `The rate card has no item "${request.body.workItemCode}"`,
                400,
                request.id,
              ),
            )
        }
        const rule = await rules.findEffective(principal.companyId, request.body.ruleCode)
        if (!rule) return notFound(reply, request.id)
        const evaluated = evaluateRule(rule, request.body.inputs)
        if (evaluated.isErr()) return sendError(reply, request.id, evaluated.error)

        line = {
          sectionId: request.body.sectionId,
          roomId: request.body.roomId ?? null,
          materialId: request.body.materialId ?? cardItem.materialId,
          workItemCode: cardItem.workItemCode,
          descriptionEn: request.body.descriptionEn ?? cardItem.descriptionEn,
          descriptionAr: request.body.descriptionAr ?? cardItem.descriptionAr,
          uom: cardItem.uom,
          quantity: evaluated.value.quantity,
          wasteFactor: evaluated.value.wastePct,
          materialRate: cardItem.materialRate,
          labourRate: cardItem.labourRate,
          equipmentRate: cardItem.equipmentRate,
          source: 'rule',
          ruleCode: rule.code,
          formulaEvaluated: evaluated.value.formulaEvaluated,
          formulaInputs: evaluated.value.inputs,
          sortOrder: boq.lines.length,
        }
      } else {
        if (!request.body.quantity) {
          return reply
            .status(400)
            .send(
              problem('BOQ_QUANTITY_REQUIRED', 'A manual line needs a quantity', 400, request.id),
            )
        }
        // Card rates are authoritative where the work item exists; a manual
        // line off the card must bring everything itself.
        if (!cardItem && !(request.body.uom && request.body.descriptionEn)) {
          return reply
            .status(400)
            .send(
              problem(
                'BOQ_LINE_INCOMPLETE',
                'Off-card lines need uom, descriptions and rates',
                400,
                request.id,
              ),
            )
        }
        line = {
          sectionId: request.body.sectionId,
          roomId: request.body.roomId ?? null,
          materialId: request.body.materialId ?? cardItem?.materialId ?? null,
          workItemCode: request.body.workItemCode,
          descriptionEn: request.body.descriptionEn ?? cardItem?.descriptionEn ?? '',
          descriptionAr: request.body.descriptionAr ?? cardItem?.descriptionAr ?? '',
          uom: (request.body.uom ?? cardItem?.uom) as NewLineInput['uom'],
          quantity: request.body.quantity,
          wasteFactor: request.body.wasteFactor ?? '0',
          materialRate: cardItem?.materialRate ?? request.body.materialRate ?? '0',
          labourRate: cardItem?.labourRate ?? request.body.labourRate ?? '0',
          equipmentRate: cardItem?.equipmentRate ?? request.body.equipmentRate ?? '0',
          source: 'manual',
          ruleCode: null,
          formulaEvaluated: null,
          formulaInputs: null,
          sortOrder: boq.lines.length,
        }
      }

      const added = boq.addLine(line, () => c.ids.next())
      if (added.isErr()) return sendError(reply, request.id, added.error)

      await boqs.save(boq)
      const saved = boq.lines.find((candidate) => candidate.id === added.value)
      return reply.status(201).send({
        lineId: added.value,
        quantityWithWaste: saved?.quantityWithWaste,
        lineTotal: saved?.lineTotal,
        totals: boq.totals,
      })
    },
  )

  app.delete<{ Params: { boqId: string; lineId: string } }>(
    '/api/v1/boqs/:boqId/lines/:lineId',
    { preHandler: [authenticate(c), requirePermission('boq.update')] },
    async (request, reply) => {
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)
      const result = boq.removeLine(request.params.lineId)
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await boqs.save(boq)
      return { id: boq.id, totals: boq.totals }
    },
  )

  app.put<{
    Params: { boqId: string; lineId: string }
    Body: { quantity: string; reason: string }
  }>(
    '/api/v1/boqs/:boqId/lines/:lineId/override',
    {
      preHandler: [authenticate(c), requirePermission('boq.override_line')],
      schema: {
        body: {
          type: 'object',
          required: ['quantity', 'reason'],
          additionalProperties: false,
          properties: {
            quantity: { type: 'string', pattern: DECIMAL },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)
      const result = boq.overrideLineQuantity(
        request.params.lineId,
        request.body.quantity,
        request.body.reason,
      )
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await boqs.save(boq)
      const line = boq.lines.find((candidate) => candidate.id === request.params.lineId)
      return { lineId: request.params.lineId, lineTotal: line?.lineTotal, totals: boq.totals }
    },
  )

  const transition = (
    path: 'submit' | 'reject',
    permission: 'boq.update' | 'boq.approve',
    act: (boq: Boq) => ReturnType<Boq['submit']>,
  ) => {
    app.post<{ Params: { boqId: string } }>(
      `/api/v1/boqs/:boqId/${path}`,
      { preHandler: [authenticate(c), requirePermission(permission)] },
      async (request, reply) => {
        const boq = await loadBoq(request.params.boqId)
        if (!boq) return notFound(reply, request.id)
        const result = act(boq)
        if (result.isErr()) return sendError(reply, request.id, result.error)
        await boqs.save(boq)
        return { id: boq.id, status: boq.status }
      },
    )
  }
  transition('submit', 'boq.update', (boq) => boq.submit())
  transition('reject', 'boq.approve', (boq) => boq.reject())

  app.post<{ Params: { boqId: string } }>(
    '/api/v1/boqs/:boqId/approve',
    { preHandler: [authenticate(c), requirePermission('boq.approve')] },
    async (request, reply) => {
      const principal = principalOf(request)
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)

      const result = boq.approve(principal.userId, c.clock.now())
      if (result.isErr()) return sendError(reply, request.id, result.error)
      await boqs.save(boq)

      // The predecessor is superseded by the approval of its successor — never
      // earlier, so there is always exactly one authoritative approved BOQ.
      const previous = await boqs.findApprovedForUnit(boq.unitId, String(boq.id))
      if (previous) {
        const superseded = previous.supersededBy(String(boq.id))
        if (superseded.isOk()) await boqs.save(previous)
      }

      return { id: boq.id, status: boq.status, superseded: previous ? previous.id : null }
    },
  )

  app.post<{ Params: { boqId: string } }>(
    '/api/v1/boqs/:boqId/versions',
    { preHandler: [authenticate(c), requirePermission('boq.generate')] },
    async (request, reply) => {
      const boq = await loadBoq(request.params.boqId)
      if (!boq) return notFound(reply, request.id)

      const next = boq.nextVersion(c.ids.next<'BoqId'>(), () => c.ids.next())
      if (next.isErr()) return sendError(reply, request.id, next.error)

      if (!(await boqs.create(next.value))) {
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
        id: next.value.id,
        versionNumber: next.value.versionNumber,
        status: next.value.status,
      })
    },
  )
}
