import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator } from '@buildflow/core'
import { withTenantScope, bindTenantContext, runWithoutTenantScope } from '@buildflow/database'
import {
  Argon2PasswordHasher,
  seedCompanyRoles,
  seedPermissionCatalogue,
} from '@buildflow/identity'
import { GENESIS_PREVIOUS_HASH, invoiceHash } from '@buildflow/invoicing'
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * Issued tax invoices over HTTP. docs/01 NFR-C4
 *
 * The assertions that matter are the REGULATED ones: the ICV counts up from
 * one, each invoice's PIH is the previous invoice's hash, the stored hash is
 * recomputable from the STORED bytes, and none of it is visible across a
 * tenant boundary. A chain that only looks right in memory is worthless —
 * these run against the real database through the real routes.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const INTRUDER = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let intruderToken: string
let unitId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const as =
  (token: () => string) =>
  (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const options: InjectOptions = {
      method,
      url,
      headers: { authorization: `Bearer ${token()}` },
    }
    if (payload !== undefined) options.payload = payload as never
    return app.inject(options)
  }
const api = as(() => ownerToken)
const intruderApi = as(() => intruderToken)

const SELLER_IDENTITY = {
  legalName: 'شركة التشطيبات التجريبية',
  vatNumber: '310123456700003',
  crNumber: '1010101010',
  addressStreet: 'طريق الملك فهد',
  addressBuilding: '8228',
  addressDistrict: 'العليا',
  addressCity: 'الرياض',
  addressPostal: '12211',
}

const draftBody = {
  kind: 'simplified',
  buyer: { name: 'Walk-in customer' },
  lines: [{ description: 'Tiling works', quantity: '2', unitPrice: '500.00', vatRate: '15' }],
}

const draft = async (over: Record<string, unknown> = {}): Promise<{ id: string }> => {
  const res = await api('POST', `/api/v1/units/${unitId}/tax-invoices`, {
    ...draftBody,
    ...over,
  })
  expect(res.statusCode, res.body).toBe(201)
  return res.json<{ data: { id: string } }>().data
}

const issue = async (id: string) => api('POST', `/api/v1/tax-invoices/${id}/issue`)

const seedTenant = async (companyId: string, slugPrefix: string, identity: boolean) => {
  await runWithoutTenantScope(sys, async () => {
    await raw.company.create({
      data: {
        id: companyId,
        nameEn: 'Acme',
        nameAr: 'أكمي',
        slug: `${slugPrefix}-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
        ...(identity ? SELLER_IDENTITY : {}),
      },
    })
  })
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, companyId as never, () => ids.next()),
  )
  const email = `owner-${slugPrefix}-${String(Date.now())}@acme.sa`
  const userId = ids.next()
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)
  await runWithoutTenantScope(sys, async () => {
    await raw.user.create({
      data: {
        id: userId,
        companyId,
        email,
        passwordHash: hash,
        firstNameEn: 'O',
        lastNameEn: 'U',
        status: 'active',
      },
    })
    await raw.userRole.create({
      data: { userId, roleId: roleIds['company_owner']!, companyId },
    })
  })
  return (
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { companyId, email, password: PASSWORD },
    })
  ).json<{ accessToken: string }>().accessToken
}

beforeAll(async () => {
  await raw.$connect()
  app = await buildServer({
    container: createContainer({ db, jwtSecret: randomBytes(32).toString('base64url') }),
    db,
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await raw.$disconnect()
})

beforeEach(async () => {
  await runWithoutTenantScope(sys, async () => {
    await raw.taxInvoice.deleteMany({})
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.outboxEvent.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.room.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.user.deleteMany({})
    await raw.company.deleteMany({})
  })

  await seedPermissionCatalogue(db, () => ids.next())
  ownerToken = await seedTenant(COMPANY, 'inv', true)
  intruderToken = await seedTenant(INTRUDER, 'spy', true)

  const projectId = ids.next()
  unitId = ids.next()
  await runWithoutTenantScope(sys, async () => {
    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'TAXINV-1',
        nameEn: 'P',
        nameAr: 'م',
        currency: 'SAR',
      },
    })
    await raw.unit.create({
      data: {
        id: unitId,
        companyId: COMPANY,
        projectId,
        unitNumber: '305',
        name: 'Unit 305',
        grossArea: '100',
        currency: 'SAR',
      },
    })
  })
})

describe('drafting', () => {
  it('creates a draft with computed totals and NO chain position', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/tax-invoices`, draftBody)
    expect(res.statusCode, res.body).toBe(201)
    const invoice = res.json<{ data: Record<string, unknown> }>().data

    expect(invoice['status']).toBe('draft')
    expect(invoice['icv']).toBeNull()
    expect(invoice['previousInvoiceHash']).toBeNull()
    expect(invoice['totals']).toEqual({
      taxExclusiveAmount: '1000.00',
      vatAmount: '150.00',
      taxInclusiveAmount: '1150.00',
    })
  })

  it('refuses a standard draft without the buyer VAT — the aggregate rule over HTTP', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/tax-invoices`, {
      ...draftBody,
      kind: 'standard',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('BUYER_VAT_REQUIRED')
  })

  it('refuses to draft at all while the seller identity is incomplete', async () => {
    await runWithoutTenantScope(sys, () =>
      raw.company.update({ where: { id: COMPANY }, data: { vatNumber: null } }),
    )
    const res = await api('POST', `/api/v1/units/${unitId}/tax-invoices`, draftBody)
    expect(res.statusCode).toBe(422)
    expect(res.json<{ code: string }>().code).toBe('SELLER_IDENTITY_INCOMPLETE')
  })
})

describe('issuing — the regulated moment', () => {
  it('allocates ICV 1 and the genesis hash to the first invoice', async () => {
    const { id } = await draft()
    const res = await issue(id)
    expect(res.statusCode, res.body).toBe(200)
    const invoice = res.json<{ data: Record<string, unknown> }>().data

    expect(invoice['status']).toBe('issued')
    expect(invoice['icv']).toBe(1)
    expect(invoice['previousInvoiceHash']).toBe(GENESIS_PREVIOUS_HASH)
    expect(invoice['invoiceHash']).toBeTruthy()
    expect(invoice['qr']).toBeTruthy()
  })

  it('chains: the second invoice carries the FIRST invoice hash as its PIH', async () => {
    const first = await draft()
    const firstIssued = await issue(first.id)
    const firstHash = firstIssued.json<{ data: { invoiceHash: string } }>().data.invoiceHash

    const second = await draft()
    const secondIssued = await issue(second.id)
    const invoice = secondIssued.json<{ data: { icv: number; previousInvoiceHash: string } }>().data

    expect(invoice.icv).toBe(2)
    expect(invoice.previousInvoiceHash).toBe(firstHash)
    expect(invoice.previousInvoiceHash).not.toBe(GENESIS_PREVIOUS_HASH)
  })

  it('stores the document whose bytes recompute to the stored hash', async () => {
    const { id } = await draft()
    await issue(id)
    const res = await api('GET', `/api/v1/tax-invoices/${id}/document`)
    expect(res.statusCode).toBe(200)
    const { xml, invoiceHash: stored } = res.json<{
      data: { xml: string; invoiceHash: string }
    }>().data

    // The whole design in one line: the stored bytes hash to the stored hash.
    expect(invoiceHash(xml)).toBe(stored)
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388<')
  })

  it('refuses a second issue and refuses issue without the full identity', async () => {
    const { id } = await draft()
    await issue(id)
    expect((await issue(id)).statusCode).toBe(409)

    await runWithoutTenantScope(sys, () =>
      raw.company.update({ where: { id: COMPANY }, data: { addressCity: null } }),
    )
    const { id: next } = await draft()
    const res = await issue(next)
    expect(res.statusCode).toBe(422)
  })
})

describe('tenant isolation', () => {
  it('never shows another tenant an invoice, issued or drafted', async () => {
    const { id } = await draft()
    await issue(id)

    expect((await intruderApi('GET', `/api/v1/tax-invoices/${id}`)).statusCode).toBe(404)
    expect((await intruderApi('GET', `/api/v1/tax-invoices/${id}/document`)).statusCode).toBe(404)
    expect((await intruderApi('POST', `/api/v1/tax-invoices/${id}/issue`)).statusCode).toBe(404)
    const list = await intruderApi('GET', `/api/v1/units/${unitId}/tax-invoices`)
    expect(list.json<{ data: unknown[] }>().data).toEqual([])
  })

  it('keeps the ICV chain PER TENANT — the intruder issuing does not advance ours', async () => {
    // Give the intruder their own unit and invoice.
    const intruderProject = ids.next()
    const intruderUnit = ids.next()
    await runWithoutTenantScope(sys, async () => {
      await raw.project.create({
        data: {
          id: intruderProject,
          companyId: INTRUDER,
          code: 'SPY-1',
          nameEn: 'P',
          nameAr: 'م',
          currency: 'SAR',
        },
      })
      await raw.unit.create({
        data: {
          id: intruderUnit,
          companyId: INTRUDER,
          projectId: intruderProject,
          unitNumber: '1',
          name: 'U',
          grossArea: '50',
          currency: 'SAR',
        },
      })
    })
    const theirs = await intruderApi(
      'POST',
      `/api/v1/units/${intruderUnit}/tax-invoices`,
      draftBody,
    )
    expect(theirs.statusCode, theirs.body).toBe(201)
    const theirId = theirs.json<{ data: { id: string } }>().data.id
    const theirIssue = await intruderApi('POST', `/api/v1/tax-invoices/${theirId}/issue`)
    expect(theirIssue.statusCode, theirIssue.body).toBe(200)
    expect(theirIssue.json<{ data: { icv: number } }>().data.icv).toBe(1)

    // Ours still starts at 1, with the genesis hash: two tenants, two chains.
    const { id } = await draft()
    const ours = await issue(id)
    const invoice = ours.json<{ data: { icv: number; previousInvoiceHash: string } }>().data
    expect(invoice.icv).toBe(1)
    expect(invoice.previousInvoiceHash).toBe(GENESIS_PREVIOUS_HASH)
  })
})
