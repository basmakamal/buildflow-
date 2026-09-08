import type { FastifyInstance } from 'fastify'
import type { Database } from '@buildflow/database'
import { isKsaVatNumber } from '@buildflow/invoicing'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem } from '../server'

/**
 * Company settings over HTTP — for now, the tax identity. docs/04 §2.1
 *
 * These fields exist because a tax invoice prints them: the registered legal
 * name, the VAT registration, the CR, and the national address. They were
 * settable only by a database hand-edit, which made the invoicing module's
 * honest refusals (SELLER_IDENTITY_INCOMPLETE) a dead end for an actual user.
 *
 * The VAT format is validated with THE SAME exported rule the tax-invoice
 * aggregate enforces — the alternative is two format rules that drift apart
 * and a settings page that accepts what issuing then refuses.
 */
export function registerCompanyRoutes(app: FastifyInstance, c: Container, db: Database): void {
  interface TaxIdentity {
    legalName: string | null
    vatNumber: string | null
    crNumber: string | null
    address: {
      street: string | null
      buildingNumber: string | null
      district: string | null
      city: string | null
      postalCode: string | null
    }
    /** What the invoicing module will say: may this tenant issue yet? */
    complete: boolean
  }

  const identityOf = (company: {
    legalName: string | null
    vatNumber: string | null
    crNumber: string | null
    addressStreet: string | null
    addressBuilding: string | null
    addressDistrict: string | null
    addressCity: string | null
    addressPostal: string | null
  }): TaxIdentity => ({
    legalName: company.legalName,
    vatNumber: company.vatNumber,
    crNumber: company.crNumber,
    address: {
      street: company.addressStreet,
      buildingNumber: company.addressBuilding,
      district: company.addressDistrict,
      city: company.addressCity,
      postalCode: company.addressPostal,
    },
    complete: Boolean(
      company.legalName &&
      company.vatNumber &&
      company.crNumber &&
      company.addressStreet &&
      company.addressBuilding &&
      company.addressDistrict &&
      company.addressCity &&
      company.addressPostal,
    ),
  })

  app.get(
    '/api/v1/company/tax-identity',
    { preHandler: [authenticate(c), requirePermission('company.view_settings')] },
    async (request, reply) => {
      const principal = principalOf(request)
      const company = await db.company.findFirst({ where: { id: principal.companyId } })
      if (!company) {
        return reply.status(404).send(problem('NOT_FOUND', 'Company not found', 404, request.id))
      }
      return { data: identityOf(company) }
    },
  )

  interface PutBody {
    legalName: string
    vatNumber: string
    crNumber: string
    address: {
      street: string
      buildingNumber: string
      district: string
      city: string
      postalCode: string
    }
  }

  app.put<{ Body: PutBody }>(
    '/api/v1/company/tax-identity',
    {
      preHandler: [authenticate(c), requirePermission('company.update_settings')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['legalName', 'vatNumber', 'crNumber', 'address'],
          properties: {
            legalName: { type: 'string', minLength: 1, maxLength: 200 },
            vatNumber: { type: 'string', minLength: 15, maxLength: 15 },
            crNumber: { type: 'string', minLength: 1, maxLength: 20 },
            address: {
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
      if (!isKsaVatNumber(request.body.vatNumber)) {
        return reply
          .status(400)
          .send(
            problem(
              'SELLER_VAT_INVALID',
              'A KSA VAT registration is 15 digits starting and ending with 3',
              400,
              request.id,
            ),
          )
      }

      const principal = principalOf(request)
      const updated = await db.company.update({
        where: { id: principal.companyId },
        data: {
          legalName: request.body.legalName.trim(),
          vatNumber: request.body.vatNumber,
          crNumber: request.body.crNumber.trim(),
          addressStreet: request.body.address.street.trim(),
          addressBuilding: request.body.address.buildingNumber.trim(),
          addressDistrict: request.body.address.district.trim(),
          addressCity: request.body.address.city.trim(),
          addressPostal: request.body.address.postalCode.trim(),
        },
      })
      return { data: identityOf(updated) }
    },
  )
}
