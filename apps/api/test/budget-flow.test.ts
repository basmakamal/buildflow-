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
 * Budgets and profitability over HTTP: append-only revisions with mandatory
 * reasons, the currency gate, and the report that answers "did unit 305 make
 * money, and where did it leak?" — the sprint's exit criterion.
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
const STAGE_FLOORING = '01912345-0000-7000-8000-00000000f100'

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

const BUCKETS = {
  materialBudget: '52000',
  labourBudget: '23500.50',
  equipmentBudget: '3200',
  overheadBudget: '1299.50',
}

const createBaseline = async (): Promise<string> => {
  const res = await api('POST', `/api/v1/units/${unitA}/budgets`, {
    ...BUCKETS,
    currency: 'SAR',
  })
  expect(res.statusCode).toBe(201)
  return res.json<{ id: string }>().id
}

/** Books an invoice and allocates all of it to unitA (optionally one stage). */
const bookCost = async (unitStageId: string | null = null): Promise<void> => {
  const created = await api('POST', '/api/v1/invoices', {
    supplierId,
    invoiceNumber: `INV-${ids.next()}`,
    invoiceDate: '2026-08-20T08:00:00.000Z',
    taxRate: '15',
    currency: 'SAR',
    lines: [{ description: 'Porcelain 60x60', quantity: '70', uom: 'box', unitPrice: '79.2000' }],
  })
  expect(created.statusCode).toBe(201)
  const invoiceId = created.json<{ id: string }>().id

  const allocated = await api('PUT', `/api/v1/invoices/${invoiceId}/allocations`, {
    byAmount: [{ unitId: unitA, unitStageId, amount: '6375.60' }],
  })
  expect(allocated.statusCode).toBe(200)
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
    await raw.outboxEvent.deleteMany({})
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
        slug: `acme-bud-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitA = ids.next()
    supplierId = ids.next()

    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'BUD-1',
        nameEn: 'P',
        nameAr: 'م',
        currency: 'SAR',
      },
    })
    await raw.unit.create({
      data: {
        id: unitA,
        companyId: COMPANY,
        projectId,
        unitNumber: '305',
        name: 'Unit 305',
        grossArea: '100',
        currency: 'SAR',
      },
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

  const email = `owner-bud-${String(Date.now())}@acme.sa`
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

describe('the baseline', () => {
  it('derives the total server-side and starts at revision 1', async () => {
    const res = await api('POST', `/api/v1/units/${unitA}/budgets`, {
      ...BUCKETS,
      currency: 'SAR',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<{ revision: number; totalBudget: string }>()).toMatchObject({
      revision: 1,
      totalBudget: '80000.00',
    })
  })

  it('refuses a budget in a currency the unit is not costed in', async () => {
    const res = await api('POST', `/api/v1/units/${unitA}/budgets`, {
      ...BUCKETS,
      currency: 'USD',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('BUDGET_CURRENCY_MISMATCH')
  })

  it('404s a unit that does not exist', async () => {
    const res = await api('POST', `/api/v1/units/${ids.next()}/budgets`, {
      ...BUCKETS,
      currency: 'SAR',
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('revisions', () => {
  it('demands a reason once history exists, then appends revision 2', async () => {
    await createBaseline()

    const unexplained = await api('POST', `/api/v1/units/${unitA}/budgets`, {
      ...BUCKETS,
      materialBudget: '67000',
      currency: 'SAR',
    })
    expect(unexplained.statusCode).toBe(400)
    expect(unexplained.json<{ code: string }>().code).toBe('BUDGET_REVISION_NEEDS_REASON')

    const revised = await api('POST', `/api/v1/units/${unitA}/budgets`, {
      ...BUCKETS,
      materialBudget: '67000',
      currency: 'SAR',
      revisionReason: 'Client upgraded to premium porcelain',
    })
    expect(revised.statusCode).toBe(201)
    expect(revised.json<{ revision: number; totalBudget: string }>()).toMatchObject({
      revision: 2,
      totalBudget: '95000.00',
    })
  })

  it('keeps every revision readable — the history is the point', async () => {
    await createBaseline()
    await api('POST', `/api/v1/units/${unitA}/budgets`, {
      ...BUCKETS,
      materialBudget: '67000',
      currency: 'SAR',
      revisionReason: 'scope change',
    })

    const res = await api('GET', `/api/v1/units/${unitA}/budgets`)
    expect(res.statusCode).toBe(200)
    const history = res.json<{ data: { revision: number; totalBudget: string }[] }>().data
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ revision: 1, totalBudget: '80000.00' })
    expect(history[1]).toMatchObject({ revision: 2, totalBudget: '95000.00' })
  })

  it('stage budgets are their own revision chain, refining the whole-unit one', async () => {
    await createBaseline()
    const res = await api('POST', `/api/v1/units/${unitA}/budgets`, {
      ...BUCKETS,
      unitStageId: STAGE_FLOORING,
      currency: 'SAR',
    })
    expect(res.statusCode).toBe(201)
    // Revision 1, not 2: a different scope starts its own history.
    expect(res.json<{ revision: number }>().revision).toBe(1)
  })
})

describe('the profitability report', () => {
  it('answers "did unit 305 make money" from baseline and allocated actuals', async () => {
    await createBaseline()
    await bookCost()

    const res = await api('GET', `/api/v1/units/${unitA}/profitability`)
    expect(res.statusCode).toBe(200)
    const report = res.json<{
      currency: string
      budget: { revision: number; totalBudget: string }
      actualCost: string
      variance: string
      budgetUtilization: string
      overBudget: boolean
    }>()
    expect(report.currency).toBe('SAR')
    expect(report.budget).toMatchObject({ revision: 1, totalBudget: '80000.00' })
    expect(report.actualCost).toBe('6375.60')
    expect(report.variance).toBe('73624.40')
    expect(report.budgetUtilization).toBe('7.97')
    expect(report.overBudget).toBe(false)
  })

  it('flags an overrun when actuals pass the baseline', async () => {
    const res = await api('POST', `/api/v1/units/${unitA}/budgets`, {
      materialBudget: '5000',
      labourBudget: '0',
      equipmentBudget: '0',
      overheadBudget: '0',
      currency: 'SAR',
    })
    expect(res.statusCode).toBe(201)
    await bookCost()

    const report = await api('GET', `/api/v1/units/${unitA}/profitability`)
    expect(
      report.json<{ variance: string; overBudget: boolean; budgetUtilization: string }>(),
    ).toMatchObject({
      variance: '-1375.60',
      overBudget: true,
      budgetUtilization: '127.51',
    })
  })

  it('shows where it leaked — stage spend with no stage baseline is the leak', async () => {
    await createBaseline()
    await bookCost(STAGE_FLOORING)

    const report = api('GET', `/api/v1/units/${unitA}/profitability`)
    const body = (await report).json<{
      actualCost: string
      stages: { unitStageId: string; budget: unknown; actualCost: string; overBudget: boolean }[]
    }>()
    // Stage allocations still count toward the whole unit — refine, not replace.
    expect(body.actualCost).toBe('6375.60')
    expect(body.stages).toHaveLength(1)
    expect(body.stages[0]).toMatchObject({
      unitStageId: STAGE_FLOORING,
      budget: null,
      actualCost: '6375.60',
      overBudget: true,
    })
  })

  it('ignores void invoices — void money is not cost', async () => {
    await createBaseline()

    const created = await api('POST', '/api/v1/invoices', {
      supplierId,
      invoiceNumber: 'INV-VOID',
      invoiceDate: '2026-08-20T08:00:00.000Z',
      taxRate: '15',
      currency: 'SAR',
      lines: [{ description: 'Tiles', quantity: '70', uom: 'box', unitPrice: '79.2000' }],
    })
    const invoiceId = created.json<{ id: string }>().id
    await api('PUT', `/api/v1/invoices/${invoiceId}/allocations`, {
      byAmount: [{ unitId: unitA, amount: '6375.60' }],
    })
    await api('POST', `/api/v1/invoices/${invoiceId}/void`, { reason: 'booked twice' })

    const report = await api('GET', `/api/v1/units/${unitA}/profitability`)
    expect(report.json<{ actualCost: string; overBudget: boolean }>()).toMatchObject({
      actualCost: '0.00',
      overBudget: false,
    })
  })
})
