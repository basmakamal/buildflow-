import type { FastifyInstance } from 'fastify'
import type { DomainError, TaxInvoiceId } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  PrismaTaxInvoiceRepository,
  validateDraft,
  type BuyerIdentity,
  type SellerDetails,
  type TaxInvoiceKind,
  type TaxInvoiceLineInput,
} from '@buildflow/invoicing'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Issued tax invoices over HTTP. Phase 7 regulatory track. docs/01 NFR-C4
 *
 * Guarded by the `invoice.*` permission family — deliberately the SAME family
 * as supplier invoices, because "may handle the company's invoices" is one
 * privilege in every role model we have seen, not two.
 *
 * The seller identity comes from the COMPANY ROW at issue time, never from
 * the request: what a tax document says about the seller is a fact about the
 * tenant, not an input a client gets to vary per call. Issuing refuses while
 * the company's tax identity is incomplete — the honest failure the schema
 * comment promises.
 */
export function registerTaxInvoiceRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const invoices = new PrismaTaxInvoiceRepository(db)
  const ids = c.ids
  const clock = c.clock

  interface Replyish {
    status(code: number): { send(body: unknown): unknown }
  }
  const sendError = (reply: Replyish, requestId: unknown, error: DomainError) => {
    const status = statusFor(error)
    return reply.status(status).send(problem(error.code, error.message, status, requestId))
  }
  const notFound = (reply: Replyish, requestId: unknown) =>
    reply.status(404).send(problem('NOT_FOUND', 'Resource not found', 404, requestId))

  const DECIMAL = '^\\d{1,14}(\\.\\d{1,4})?$'
  const lineSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'quantity', 'unitPrice', 'vatRate'],
    properties: {
      description: { type: 'string', minLength: 1, maxLength: 500 },
      quantity: { type: 'string', pattern: '^\\d{1,10}(\\.\\d{1,4})?$' },
      unitPrice: { type: 'string', pattern: DECIMAL },
      vatRate: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
    },
  }

  interface DraftBody {
    kind: TaxInvoiceKind
    buyer: { name: string; vatNumber?: string | null }
    lines: TaxInvoiceLineInput[]
    quotationId?: string
  }

  app.post<{ Params: { unitId: string }; Body: DraftBody }>(
    '/api/v1/units/:unitId/tax-invoices',
    {
      preHandler: [authenticate(c), requirePermission('invoice.create')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'buyer', 'lines'],
          properties: {
            kind: { enum: ['standard', 'simplified'] },
            buyer: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 200 },
                vatNumber: { type: ['string', 'null'], minLength: 15, maxLength: 15 },
              },
            },
            lines: { type: 'array', minItems: 1, maxItems: 200, items: lineSchema },
            quotationId: { type: 'string', minLength: 36, maxLength: 36 },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const company = await db.company.findFirst({ where: { id: principal.companyId } })
      if (!company) return notFound(reply, request.id)

      // Draft validation needs the seller's VAT to run the aggregate's rules;
      // an incomplete tax identity fails HERE, at the first invoice attempt,
      // not at issue time three steps later.
      if (!company.legalName || !company.vatNumber) {
        return reply
          .status(422)
          .send(
            problem(
              'SELLER_IDENTITY_INCOMPLETE',
              'Set the company legal name and VAT registration before invoicing',
              422,
              request.id,
            ),
          )
      }

      const id = ids.next<'TaxInvoiceId'>()
      const buyer: BuyerIdentity = {
        name: request.body.buyer.name,
        vatNumber: request.body.buyer.vatNumber ?? null,
      }

      // Claimed optimistically; the unique key arbitrates, the loop retries.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const count = await db.taxInvoice.count()
        const invoiceNumber = `INV-${String(clock.now().getUTCFullYear())}-${String(count + 1 + attempt).padStart(4, '0')}`

        const validated = validateDraft({
          id,
          companyId: principal.companyId,
          kind: request.body.kind,
          invoiceNumber,
          uuid: ids.next(),
          seller: { name: company.legalName, vatNumber: company.vatNumber },
          buyer,
          lines: request.body.lines,
        })
        if (validated.isErr()) return sendError(reply, request.id, validated.error)
        const snapshot = validated.value.snapshot()

        const created = await invoices.create({
          id,
          unitId: request.params.unitId,
          quotationId: request.body.quotationId ?? null,
          kind: request.body.kind,
          invoiceNumber,
          uuid: snapshot.uuid,
          buyer,
          lines: snapshot.lines,
          totals: snapshot.totals,
        })
        if (created) {
          return reply.status(201).send({ data: await invoices.findById(id) })
        }
      }
      return reply
        .status(409)
        .send(problem('INVOICE_NUMBER_CONTENTION', 'Could not claim a number', 409, request.id))
    },
  )

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/tax-invoices',
    { preHandler: [authenticate(c), requirePermission('invoice.view')] },
    async (request) => ({ data: await invoices.listForUnit(request.params.unitId) }),
  )

  app.get<{ Params: { invoiceId: string } }>(
    '/api/v1/tax-invoices/:invoiceId',
    { preHandler: [authenticate(c), requirePermission('invoice.view')] },
    async (request, reply) => {
      const invoice = await invoices.findById(request.params.invoiceId as TaxInvoiceId)
      if (!invoice) return notFound(reply, request.id)
      return { data: invoice }
    },
  )

  interface IssueBody {
    buyerAddress?: {
      street: string
      buildingNumber: string
      district: string
      city: string
      postalCode: string
    }
  }

  app.post<{ Params: { invoiceId: string }; Body: IssueBody | undefined }>(
    '/api/v1/tax-invoices/:invoiceId/issue',
    {
      preHandler: [authenticate(c), requirePermission('invoice.create')],
      schema: {
        body: {
          type: ['object', 'null'],
          additionalProperties: false,
          properties: {
            buyerAddress: {
              type: 'object',
              additionalProperties: false,
              required: ['street', 'buildingNumber', 'district', 'city', 'postalCode'],
              properties: {
                street: { type: 'string', minLength: 1, maxLength: 200 },
                buildingNumber: { type: 'string', minLength: 1, maxLength: 20 },
                district: { type: 'string', minLength: 1, maxLength: 120 },
                city: { type: 'string', minLength: 1, maxLength: 120 },
                postalCode: { type: 'string', minLength: 1, maxLength: 10 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = principalOf(request)
      const company = await db.company.findFirst({ where: { id: principal.companyId } })
      if (!company) return notFound(reply, request.id)

      if (
        !company.legalName ||
        !company.vatNumber ||
        !company.crNumber ||
        !company.addressStreet ||
        !company.addressBuilding ||
        !company.addressDistrict ||
        !company.addressCity ||
        !company.addressPostal
      ) {
        return reply
          .status(422)
          .send(
            problem(
              'SELLER_IDENTITY_INCOMPLETE',
              'Issuing needs the full company tax identity: legal name, VAT, CR and national address',
              422,
              request.id,
            ),
          )
      }
      const seller: SellerDetails = {
        name: company.legalName,
        vatNumber: company.vatNumber,
        crNumber: company.crNumber,
        address: {
          street: company.addressStreet,
          buildingNumber: company.addressBuilding,
          district: company.addressDistrict,
          city: company.addressCity,
          postalCode: company.addressPostal,
        },
      }

      const issued = await invoices.issue(
        request.params.invoiceId as TaxInvoiceId,
        seller,
        request.body?.buyerAddress ?? null,
        clock.now(),
      )
      if (issued.isErr()) return sendError(reply, request.id, issued.error)
      return { data: issued.value }
    },
  )

  /**
   * The document itself: the stored bytes, never a re-render. The XML column
   * is the chain's source of truth — regenerating on read would invite a
   * byte-different document whose hash no longer matches the chain.
   */
  app.get<{ Params: { invoiceId: string } }>(
    '/api/v1/tax-invoices/:invoiceId/document',
    { preHandler: [authenticate(c), requirePermission('invoice.view')] },
    async (request, reply) => {
      const invoice = await invoices.findById(request.params.invoiceId as TaxInvoiceId)
      if (!invoice) return notFound(reply, request.id)
      if (invoice.status !== 'issued' || !invoice.xml) {
        return reply
          .status(409)
          .send(
            problem(
              'TAX_INVOICE_NOT_ISSUED',
              'Only issued invoices have a document',
              409,
              request.id,
            ),
          )
      }
      return {
        data: {
          xml: invoice.xml,
          qr: invoice.qr,
          invoiceHash: invoice.invoiceHash,
          icv: invoice.icv,
        },
      }
    },
  )
}
