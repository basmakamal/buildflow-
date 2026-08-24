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
 * Variance alerts: a `budget.exceeded` event lands in the transactional outbox
 * when allocations push a scope past its baseline, or when a baseline is
 * approved below money already spent. ONE alert per baseline — later
 * allocations against the same exceeded revision stay silent, and a new
 * revision re-arms the alert.
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

const setBudget = async (total: string, over: Record<string, unknown> = {}): Promise<void> => {
  const res = await api('POST', `/api/v1/units/${unitA}/budgets`, {
    materialBudget: total,
    labourBudget: '0',
    equipmentBudget: '0',
    overheadBudget: '0',
    currency: 'SAR',
    ...over,
  })
  expect(res.statusCode).toBe(201)
}

let invoiceCounter = 0

/** Books a 1000.00 SAR invoice and allocates it to unitA (optionally a stage). */
const bookCost = async (unitStageId: string | null = null): Promise<string> => {
  invoiceCounter += 1
  const created = await api('POST', '/api/v1/invoices', {
    supplierId,
    invoiceNumber: `INV-${String(invoiceCounter)}`,
    invoiceDate: '2026-08-20T08:00:00.000Z',
    taxRate: '0',
    currency: 'SAR',
    lines: [{ description: 'Materials', quantity: '1', uom: 'set', unitPrice: '1000' }],
  })
  expect(created.statusCode).toBe(201)
  const invoiceId = created.json<{ id: string }>().id

  const allocated = await api('PUT', `/api/v1/invoices/${invoiceId}/allocations`, {
    byAmount: [{ unitId: unitA, unitStageId, amount: '1000.00' }],
  })
  expect(allocated.statusCode).toBe(200)
  return invoiceId
}

const alerts = () =>
  runWithoutTenantScope(sys, () =>
    raw.outboxEvent.findMany({
      where: { eventType: 'budget.exceeded' },
      orderBy: { occurredAt: 'asc' },
    }),
  )

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
        slug: `acme-var-${String(Date.now())}`,
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
        code: 'VAR-1',
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

  const email = `owner-var-${String(Date.now())}@acme.sa`
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

describe('allocations crossing the baseline', () => {
  it('writes one budget.exceeded event with the honest numbers', async () => {
    await setBudget('1500')
    await bookCost() // 1000.00 — within
    expect(await alerts()).toHaveLength(0)

    await bookCost() // 2000.00 — over
    const events = await alerts()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      companyId: COMPANY,
      aggregateType: 'Budget',
      eventType: 'budget.exceeded',
      publishedAt: null,
    })
    expect(events[0]!.payload).toMatchObject({
      unitId: unitA,
      unitStageId: null,
      revision: 1,
      totalBudget: '1500.00',
      actualCost: '2000.00',
      exceededBy: '500.00',
      currency: 'SAR',
    })
  })

  it('stays silent on later allocations against the same exceeded baseline', async () => {
    await setBudget('1500')
    await bookCost()
    await bookCost() // crossing — alert
    await bookCost() // still over the same baseline — silent
    expect(await alerts()).toHaveLength(1)
  })

  it('a scope with no baseline raises nothing — there is no promise to break', async () => {
    await bookCost()
    expect(await alerts()).toHaveLength(0)
  })

  it('watches stage baselines independently of the whole-unit one', async () => {
    await setBudget('50000') // whole unit — generous
    await setBudget('800', { unitStageId: STAGE_FLOORING }) // stage — tight

    await bookCost(STAGE_FLOORING) // 1000.00 on the stage
    const events = await alerts()
    expect(events).toHaveLength(1)
    expect(events[0]!.payload).toMatchObject({
      unitStageId: STAGE_FLOORING,
      totalBudget: '800.00',
      actualCost: '1000.00',
      exceededBy: '200.00',
    })
  })
})

describe('baselines approved below existing spend', () => {
  it('alerts immediately — exceeded from birth', async () => {
    await bookCost() // 1000.00, no baseline yet
    await setBudget('900')

    const events = await alerts()
    expect(events).toHaveLength(1)
    expect(events[0]!.payload).toMatchObject({
      revision: 1,
      totalBudget: '900.00',
      actualCost: '1000.00',
      exceededBy: '100.00',
    })
  })

  it('a new revision re-arms the alert: silent above, loud below', async () => {
    await setBudget('1500')
    await bookCost()
    await bookCost() // alert #1 against revision 1

    // Revision 2 lifts the baseline above the spend — nothing new to say.
    await setBudget('3000', { revisionReason: 'scope grew' })
    expect(await alerts()).toHaveLength(1)

    // Revision 3 cuts it below the spend — a new promise, immediately broken.
    await setBudget('1800', { revisionReason: 'client cut the budget' })
    const events = await alerts()
    expect(events).toHaveLength(2)
    expect(events[1]!.payload).toMatchObject({
      revision: 3,
      totalBudget: '1800.00',
      actualCost: '2000.00',
      exceededBy: '200.00',
    })
  })

  it('voided invoices do not count toward the actuals it judges', async () => {
    const invoiceId = await bookCost() // 1000.00
    await api('POST', `/api/v1/invoices/${invoiceId}/void`, { reason: 'booked twice' })

    await setBudget('900') // above the surviving actuals of 0.00
    expect(await alerts()).toHaveLength(0)
  })
})
