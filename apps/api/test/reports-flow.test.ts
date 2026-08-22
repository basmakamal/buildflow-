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
 * Spend reports and supplier performance over HTTP: void money is not spend,
 * grouping never converts currencies, attributed unit spend follows the
 * allocations exactly, and performance rates are honest about their
 * denominator — null when nothing was measured, never a flattering 100%.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let supplierA: string
let supplierB: string
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

/** Books an invoice with a single tax-free line so the total is exact. */
const bookInvoice = async (
  supplierId: string,
  invoiceNumber: string,
  invoiceDate: string,
  total: string,
): Promise<string> => {
  const res = await api('POST', '/api/v1/invoices', {
    supplierId,
    invoiceNumber,
    invoiceDate,
    taxRate: '0',
    currency: 'SAR',
    lines: [{ description: 'Materials', quantity: '1', uom: 'set', unitPrice: total }],
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
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)

  await runWithoutTenantScope(sys, async () => {
    await raw.budget.deleteMany({})
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
        slug: `acme-rep-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitA = ids.next()
    unitB = ids.next()
    supplierA = ids.next()
    supplierB = ids.next()

    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'REP-1',
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
          unitNumber: '101',
          name: 'Unit 101',
          grossArea: '100',
          currency: 'SAR',
        },
        {
          id: unitB,
          companyId: COMPANY,
          projectId,
          unitNumber: '102',
          name: 'Unit 102',
          grossArea: '100',
          currency: 'SAR',
        },
      ],
    })
    await raw.supplier.createMany({
      data: [
        {
          id: supplierA,
          companyId: COMPANY,
          code: 'SUP-A',
          nameEn: 'Tile Trader',
          nameAr: 'تاجر البلاط',
        },
        {
          id: supplierB,
          companyId: COMPANY,
          code: 'SUP-B',
          nameEn: 'Paint People',
          nameAr: 'أهل الدهان',
        },
      ] as never,
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-rep-${String(Date.now())}@acme.sa`
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

  // The spend fixture every test reads: two suppliers, three live invoices
  // across two months, one void invoice that must never count.
  await bookInvoice(supplierA, 'INV-A1', '2026-08-05T08:00:00.000Z', '1000')
  await bookInvoice(supplierA, 'INV-A2', '2026-07-10T08:00:00.000Z', '500')
  await bookInvoice(supplierB, 'INV-B1', '2026-08-06T08:00:00.000Z', '750')
  const voided = await bookInvoice(supplierB, 'INV-VOID', '2026-08-07T08:00:00.000Z', '200')
  await api('POST', `/api/v1/invoices/${voided}/void`, { reason: 'booked twice' })
})

describe('spend by supplier', () => {
  it('sums non-void invoices exactly, per supplier', async () => {
    const res = await api('GET', '/api/v1/reports/spend?groupBy=supplier')
    expect(res.statusCode).toBe(200)
    const { data } = res.json<{
      data: { code: string; invoiceCount: number; spend: { currency: string; amount: string }[] }[]
    }>()
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      code: 'SUP-A',
      invoiceCount: 2,
      spend: [{ currency: 'SAR', amount: '1500.00' }],
    })
    // The 200.00 void invoice is absent: void money is not spend.
    expect(data[1]).toMatchObject({
      code: 'SUP-B',
      invoiceCount: 1,
      spend: [{ currency: 'SAR', amount: '750.00' }],
    })
  })

  it('respects the date range', async () => {
    const res = await api('GET', '/api/v1/reports/spend?from=2026-08-01T00:00:00.000Z')
    const { data } = res.json<{ data: { code: string; spend: { amount: string }[] }[] }>()
    expect(data[0]).toMatchObject({ code: 'SUP-A', spend: [{ amount: '1000.00' }] })
  })

  it('is the default grouping', async () => {
    const res = await api('GET', '/api/v1/reports/spend')
    expect(res.json<{ groupBy: string }>().groupBy).toBe('supplier')
  })
})

describe('spend by unit', () => {
  it('follows the allocations exactly — attributed spend, not invoice totals', async () => {
    const invoices = await api('GET', '/api/v1/invoices?supplierId=' + supplierA)
    const inv = invoices
      .json<{ data: { id: string; invoiceNumber: string }[] }>()
      .data.find((row) => row.invoiceNumber === 'INV-A1')!
    await api('PUT', `/api/v1/invoices/${inv.id}/allocations`, {
      byAmount: [
        { unitId: unitA, amount: '600.00' },
        { unitId: unitB, amount: '400.00' },
      ],
    })

    const res = await api('GET', '/api/v1/reports/spend?groupBy=unit')
    const { data } = res.json<{
      data: { unitNumber: string; spend: { currency: string; amount: string }[] }[]
    }>()
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ unitNumber: '101', spend: [{ amount: '600.00' }] })
    expect(data[1]).toMatchObject({ unitNumber: '102', spend: [{ amount: '400.00' }] })
  })
})

describe('spend by month', () => {
  it('groups on the invoice date, in UTC', async () => {
    const res = await api('GET', '/api/v1/reports/spend?groupBy=month')
    const { data } = res.json<{
      data: { month: string; invoiceCount: number; spend: { amount: string }[] }[]
    }>()
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      month: '2026-07',
      invoiceCount: 1,
      spend: [{ amount: '500.00' }],
    })
    expect(data[1]).toMatchObject({
      month: '2026-08',
      invoiceCount: 2,
      spend: [{ amount: '1750.00' }],
    })
  })
})

describe('supplier performance', () => {
  it('measures the two promises — on time, and usable', async () => {
    await runWithoutTenantScope(sys, async () => {
      const poOnTime = ids.next()
      const poLate = ids.next()
      const poDraft = ids.next()
      await raw.purchaseOrder.createMany({
        data: [
          {
            id: poOnTime,
            companyId: COMPANY,
            supplierId: supplierA,
            poNumber: 'PO-00001',
            status: 'issued',
            issuedAt: new Date('2026-08-01T08:00:00Z'),
            expectedDeliveryDate: new Date('2026-08-10T00:00:00Z'),
            currency: 'SAR',
          },
          {
            id: poLate,
            companyId: COMPANY,
            supplierId: supplierA,
            poNumber: 'PO-00002',
            status: 'received',
            issuedAt: new Date('2026-07-20T08:00:00Z'),
            expectedDeliveryDate: new Date('2026-08-01T00:00:00Z'),
            currency: 'SAR',
          },
          // Draft: money not committed, must not count as an order.
          {
            id: poDraft,
            companyId: COMPANY,
            supplierId: supplierA,
            poNumber: 'PO-00003',
            status: 'draft',
            currency: 'SAR',
          },
        ],
      })

      const receiptOnTime = ids.next()
      const receiptLate = ids.next()
      await raw.goodsReceipt.createMany({
        data: [
          {
            id: receiptOnTime,
            companyId: COMPANY,
            poId: poOnTime,
            supplierId: supplierA,
            receiptNumber: 'GR-00001',
            receivedAt: new Date('2026-08-08T09:00:00Z'),
            receivedBy: ids.next(),
            clientEventId: ids.next(),
          },
          {
            id: receiptLate,
            companyId: COMPANY,
            poId: poLate,
            supplierId: supplierA,
            receiptNumber: 'GR-00002',
            receivedAt: new Date('2026-08-03T09:00:00Z'),
            receivedBy: ids.next(),
            clientEventId: ids.next(),
          },
        ],
      })
      await raw.goodsReceiptLine.createMany({
        data: [
          {
            id: ids.next(),
            companyId: COMPANY,
            receiptId: receiptOnTime,
            poLineId: ids.next(),
            materialId: ids.next(),
            quantity: '100',
            uom: 'box',
            rejectedQuantity: '0',
          },
          {
            id: ids.next(),
            companyId: COMPANY,
            receiptId: receiptOnTime,
            poLineId: ids.next(),
            materialId: ids.next(),
            quantity: '40',
            uom: 'box',
            rejectedQuantity: '5',
            rejectionReason: 'cracked tiles',
          },
          {
            id: ids.next(),
            companyId: COMPANY,
            receiptId: receiptLate,
            poLineId: ids.next(),
            materialId: ids.next(),
            quantity: '20',
            uom: 'bag',
            rejectedQuantity: '0',
          },
        ],
      })
    })

    const res = await api('GET', '/api/v1/reports/supplier-performance')
    expect(res.statusCode).toBe(200)
    const { data } = res.json<{
      data: {
        code: string
        orderCount: number
        openOrderCount: number
        receiptCount: number
        onTimeRate: string | null
        rejectionRate: string | null
        spend: { amount: string }[]
      }[]
    }>()
    expect(data).toHaveLength(2)

    // One receipt beat its PO's expected date, one missed it: 50.00. One of
    // three lines carried a rejection: 33.33.
    expect(data[0]).toMatchObject({
      code: 'SUP-A',
      orderCount: 2,
      openOrderCount: 1,
      receiptCount: 2,
      onTimeRate: '50.00',
      rejectionRate: '33.33',
      spend: [{ amount: '1500.00' }],
    })

    // Nothing measurable reports null — never a flattering 100%.
    expect(data[1]).toMatchObject({
      code: 'SUP-B',
      orderCount: 0,
      receiptCount: 0,
      onTimeRate: null,
      rejectionRate: null,
      spend: [{ amount: '750.00' }],
    })
  })
})
