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
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * Invoices over HTTP: derived totals, the exact-sum allocation invariant, the
 * payment ceiling, and void-not-delete. The unit's allocated-cost view at the
 * end is the number the profitability report will stand on.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let supplierId: string
let unitA: string
let unitB: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const api = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
  }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
}

let invoiceCounter = 0

const createInvoice = async (): Promise<string> => {
  invoiceCounter += 1
  const res = await api('POST', '/api/v1/invoices', {
    supplierId,
    invoiceNumber: `INV-${String(invoiceCounter)}`,
    invoiceDate: '2026-08-20T08:00:00.000Z',
    taxRate: '15',
    currency: 'SAR',
    lines: [{ description: 'Porcelain 60x60', quantity: '70', uom: 'box', unitPrice: '79.2000' }],
  })
  expect(res.statusCode).toBe(201)
  return res.json<{ id: string }>().id
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
  invoiceCounter = 0
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)

  await runWithoutTenantScope(sys, async () => {
    await raw.costAllocation.deleteMany({})
    await raw.invoiceLine.deleteMany({})
    await raw.invoice.deleteMany({})
    await raw.goodsReceiptLine.deleteMany({})
    await raw.goodsReceipt.deleteMany({})
    await raw.purchaseOrderLine.deleteMany({})
    await raw.purchaseOrder.deleteMany({})
    await raw.purchaseRequestLine.deleteMany({})
    await raw.purchaseRequest.deleteMany({})
    await raw.supplier.deleteMany({})
    await raw.stockMovement.deleteMany({})
    await raw.materialBalance.deleteMany({})
    await raw.stageTransition.deleteMany({})
    await raw.unitStage.deleteMany({})
    await raw.unitWorkflow.deleteMany({})
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.kbRuleOverride.deleteMany({})
    await raw.materialUomConversion.deleteMany({})
    await raw.material.deleteMany({})
    await raw.room.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.user.deleteMany({})
    await raw.company.deleteMany({})

    await raw.company.create({
      data: {
        id: COMPANY,
        nameEn: 'Acme',
        nameAr: 'أكمي',
        slug: `acme-inv-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitA = ids.next()
    unitB = ids.next()
    supplierId = ids.next()

    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'INV-1',
        nameEn: 'P',
        nameAr: 'م',
        currency: 'SAR',
      },
    })
    await raw.unit.createMany({
      data: [
        {
          id: unitA,
          companyId: COMPANY,
          projectId,
          unitNumber: 'A',
          name: 'A',
          grossArea: '100',
          currency: 'SAR',
        },
        {
          id: unitB,
          companyId: COMPANY,
          projectId,
          unitNumber: 'B',
          name: 'B',
          grossArea: '100',
          currency: 'SAR',
        },
      ],
    })
    await raw.supplier.create({
      data: {
        id: supplierId,
        companyId: COMPANY,
        code: 'SUP-1',
        nameEn: 'Tile Trader',
        nameAr: 'تاجر البلاط',
      } as never,
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-inv-${String(Date.now())}@acme.sa`
  const userId = ids.next()
  await runWithoutTenantScope(sys, async () => {
    await raw.user.create({
      data: {
        id: userId,
        companyId: COMPANY,
        email,
        passwordHash: hash,
        firstNameEn: 'O',
        lastNameEn: 'U',
        status: 'active',
      },
    })
    await raw.userRole.create({
      data: { userId, roleId: roleIds['company_owner']!, companyId: COMPANY },
    })
  })

  ownerToken = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { companyId: COMPANY, email, password: PASSWORD },
    })
  ).json<{ accessToken: string }>().accessToken
})

describe('creating an invoice', () => {
  it('derives the money server-side', async () => {
    const res = await api('POST', '/api/v1/invoices', {
      supplierId,
      invoiceNumber: 'INV-A',
      invoiceDate: '2026-08-20T08:00:00.000Z',
      taxRate: '15',
      currency: 'SAR',
      lines: [{ description: 'Tiles', quantity: '70', uom: 'box', unitPrice: '79.2000' }],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<{ subtotal: string; taxAmount: string; total: string }>()).toMatchObject({
      subtotal: '5544.00',
      taxAmount: '831.60',
      total: '6375.60',
    })
  })

  it('rejects the same supplier re-sending the same number', async () => {
    await createInvoice()
    const res = await api('POST', '/api/v1/invoices', {
      supplierId,
      invoiceNumber: 'INV-1',
      invoiceDate: '2026-08-20T08:00:00.000Z',
      currency: 'SAR',
      lines: [{ description: 'Again', quantity: '1', uom: 'pcs', unitPrice: '1' }],
    })
    expect(res.statusCode).toBe(409)
    expect(res.json<{ code: string }>().code).toBe('INVOICE_NUMBER_TAKEN')
  })
})

describe('payments', () => {
  it('settles across partial payments and refuses overpayment', async () => {
    const id = await createInvoice()

    const partial = await api('POST', `/api/v1/invoices/${id}/payments`, {
      amount: '3000',
      method: 'bank_transfer',
    })
    expect(partial.json<{ paymentStatus: string }>().paymentStatus).toBe('partially_paid')

    const over = await api('POST', `/api/v1/invoices/${id}/payments`, {
      amount: '3375.61',
      method: 'cash',
    })
    expect(over.statusCode).toBe(400)
    expect(over.json<{ code: string }>().code).toBe('PAYMENT_EXCEEDS_TOTAL')

    const settle = await api('POST', `/api/v1/invoices/${id}/payments`, {
      amount: '3375.60',
      method: 'cash',
    })
    expect(settle.json<{ paymentStatus: string; paidAmount: string }>()).toMatchObject({
      paymentStatus: 'paid',
      paidAmount: '6375.60',
    })
  })
})

describe('void, not delete', () => {
  it('voids a paid invoice with a reason', async () => {
    const id = await createInvoice()
    await api('POST', `/api/v1/invoices/${id}/payments`, { amount: '6375.60', method: 'cash' })

    const res = await api('POST', `/api/v1/invoices/${id}/void`, {
      reason: 'supplier issued a credit note',
    })
    expect(res.json<{ paymentStatus: string }>().paymentStatus).toBe('void')
  })
})

describe('cost allocation', () => {
  it('splits by percentage with the exact-sum guarantee', async () => {
    const id = await createInvoice()
    const res = await api('PUT', `/api/v1/invoices/${id}/allocations`, {
      byPercentage: [
        { unitId: unitA, percentage: '33.33' },
        { unitId: unitB, percentage: '66.67' },
      ],
    })
    expect(res.statusCode).toBe(200)

    const allocations = res.json<{ allocations: { unitId: string; amount: string }[] }>()
      .allocations
    const sum = allocations.reduce(
      (total, allocation) => total + Math.round(Number(allocation.amount) * 100),
      0,
    )
    // Σ = 6375.60 exactly, whatever the split.
    expect(sum).toBe(637560)
  })

  it('rejects amounts that miss the total by one halala', async () => {
    const id = await createInvoice()
    const res = await api('PUT', `/api/v1/invoices/${id}/allocations`, {
      byAmount: [
        { unitId: unitA, amount: '6000.00' },
        { unitId: unitB, amount: '375.59' },
      ],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('ALLOCATION_SUM_MISMATCH')
  })

  it('demands exactly one allocation mode', async () => {
    const id = await createInvoice()
    for (const body of [
      {},
      {
        byPercentage: [{ unitId: unitA, percentage: '100' }],
        byAmount: [{ unitId: unitA, amount: '6375.60' }],
      },
    ]) {
      const res = await api('PUT', `/api/v1/invoices/${id}/allocations`, body)
      expect(res.statusCode).toBe(400)
      expect(res.json<{ code: string }>().code).toBe('ALLOCATION_MODE_AMBIGUOUS')
    }
  })

  it('feeds the per-unit allocated-cost view, excluding void invoices', async () => {
    const first = await createInvoice()
    await api('PUT', `/api/v1/invoices/${first}/allocations`, {
      byAmount: [
        { unitId: unitA, amount: '6000.00' },
        { unitId: unitB, amount: '375.60' },
      ],
    })

    // A second invoice, fully on unit A — then voided. Its cost must vanish
    // from the view: void money is not cost.
    const second = await createInvoice()
    await api('PUT', `/api/v1/invoices/${second}/allocations`, {
      byAmount: [{ unitId: unitA, amount: '6375.60' }],
    })
    await api('POST', `/api/v1/invoices/${second}/void`, { reason: 'duplicate booking' })

    const res = await api('GET', `/api/v1/units/${unitA}/allocated-costs`)
    expect(res.json<{ data: { amount: string; currency: string }[] }>().data).toEqual([
      { amount: '6000.00', currency: 'SAR' },
    ])
  })

  it('re-allocation replaces the set', async () => {
    const id = await createInvoice()
    await api('PUT', `/api/v1/invoices/${id}/allocations`, {
      byPercentage: [{ unitId: unitA, percentage: '100' }],
    })
    await api('PUT', `/api/v1/invoices/${id}/allocations`, {
      byPercentage: [{ unitId: unitB, percentage: '100' }],
    })

    const unitACosts = await api('GET', `/api/v1/units/${unitA}/allocated-costs`)
    expect(unitACosts.json<{ data: unknown[] }>().data).toEqual([])

    const unitBCosts = await api('GET', `/api/v1/units/${unitB}/allocated-costs`)
    expect(unitBCosts.json<{ data: { amount: string }[] }>().data[0]?.amount).toBe('6375.60')
  })
})
