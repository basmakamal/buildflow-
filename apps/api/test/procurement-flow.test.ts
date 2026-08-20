import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator } from '@buildflow/core'
import { withTenantScope, bindTenantContext, runWithoutTenantScope } from '@buildflow/database'
import {
  Argon2PasswordHasher,
  seedCompanyRoles,
  seedPermissionCatalogue,
} from '@buildflow/identity'
import { seedMaterialCategories } from '@buildflow/catalogue'
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * The procurement chain over HTTP: request → approval → order → receipt →
 * LEDGER. The last hop is the one worth the ceremony — a receipt that does not
 * land in stock_movements leaves the margin report blind to the largest cost.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let requesterToken: string
let approverToken: string
let projectId: string
let unitId: string
let materialId: string
let supplierId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const api = (method: 'GET' | 'POST', url: string, payload?: unknown, token?: string) => {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${token ?? requesterToken}` },
  }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
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
        slug: `acme-proc-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })
  })

  await runWithoutTenantScope(sys, () => seedMaterialCategories(db, () => ids.next()))
  const category = await runWithoutTenantScope(sys, () =>
    raw.materialCategory.findFirst({ where: { code: 'flooring_porcelain' } }),
  )

  projectId = ids.next()
  unitId = ids.next()
  materialId = ids.next()
  supplierId = ids.next()

  await runWithoutTenantScope(sys, async () => {
    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'PRC-1',
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
        unitNumber: '1',
        name: 'U',
        grossArea: '100',
        currency: 'SAR',
      },
    })
    await raw.material.create({
      data: {
        id: materialId,
        companyId: COMPANY,
        categoryId: category!.id,
        sku: 'POR-60',
        nameEn: 'Porcelain 60x60',
        nameAr: 'بورسلان',
        baseUom: 'm2',
      },
    })
    await raw.materialUomConversion.create({
      data: {
        id: ids.next(),
        companyId: COMPANY,
        materialId,
        fromUom: 'box',
        toUom: 'm2',
        factor: '1.44',
      } as never,
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

  const stamp = String(Date.now())
  const makeUser = async (email: string, role: string) => {
    const userId = ids.next()
    await runWithoutTenantScope(sys, async () => {
      await raw.user.create({
        data: {
          id: userId,
          companyId: COMPANY,
          email,
          passwordHash: hash,
          firstNameEn: 'X',
          lastNameEn: 'Y',
          status: 'active',
        },
      })
      await raw.userRole.create({ data: { userId, roleId: roleIds[role]!, companyId: COMPANY } })
    })
    return (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { companyId: COMPANY, email, password: PASSWORD },
      })
    ).json<{ accessToken: string }>().accessToken
  }

  // Two owners: same permissions, different people. What separates them is the
  // DOMAIN rule, not the role — exactly what the SoD test needs to prove.
  requesterToken = await makeUser(`req-${stamp}@acme.sa`, 'company_owner')
  approverToken = await makeUser(`app-${stamp}@acme.sa`, 'company_owner')
})

const createRequest = async (): Promise<string> => {
  const res = await api('POST', '/api/v1/purchase-requests', {
    projectId,
    unitId,
    currency: 'SAR',
    lines: [{ materialId, quantity: '70', uom: 'box', estimatedUnitPrice: '79.2000' }],
  })
  expect(res.statusCode).toBe(201)
  return res.json<{ id: string }>().id
}

const approvedRequest = async (): Promise<string> => {
  const id = await createRequest()
  expect((await api('POST', `/api/v1/purchase-requests/${id}/submit`)).statusCode).toBe(200)
  expect(
    (await api('POST', `/api/v1/purchase-requests/${id}/approve`, undefined, approverToken))
      .statusCode,
  ).toBe(200)
  return id
}

const issuedOrder = async (): Promise<{ poId: string; poLineId: string }> => {
  const requestId = await approvedRequest()
  const lines = await runWithoutTenantScope(sys, () =>
    raw.purchaseRequestLine.findMany({ where: { requestId } }),
  )
  const convert = await api('POST', `/api/v1/purchase-requests/${requestId}/convert`, {
    supplierId,
    taxAmount: '831.60',
    lines: [{ requestLineId: lines[0]!.id, unitPrice: '79.2000' }],
  })
  expect(convert.statusCode).toBe(201)
  const poId = convert.json<{ id: string }>().id

  expect(
    (await api('POST', `/api/v1/purchase-orders/${poId}/issue`, undefined, approverToken))
      .statusCode,
  ).toBe(200)

  const poLines = await runWithoutTenantScope(sys, () =>
    raw.purchaseOrderLine.findMany({ where: { poId } }),
  )
  return { poId, poLineId: poLines[0]!.id }
}

describe('the approval control', () => {
  it('refuses self-approval even for a company owner', async () => {
    const id = await createRequest()
    await api('POST', `/api/v1/purchase-requests/${id}/submit`)

    // Same person, full permissions — still no.
    const res = await api('POST', `/api/v1/purchase-requests/${id}/approve`)
    expect(res.statusCode).toBe(403)
    expect(res.json<{ code: string }>().code).toBe('SELF_APPROVAL')

    // A different person with the same role may.
    expect(
      (await api('POST', `/api/v1/purchase-requests/${id}/approve`, undefined, approverToken))
        .statusCode,
    ).toBe(200)
  })

  it('requires a reason to reject', async () => {
    const id = await createRequest()
    await api('POST', `/api/v1/purchase-requests/${id}/submit`)

    const bare = await api(
      'POST',
      `/api/v1/purchase-requests/${id}/reject`,
      undefined,
      approverToken,
    )
    expect(bare.statusCode).toBe(400)
    expect(bare.json<{ code: string }>().code).toBe('REJECTION_NEEDS_REASON')

    const reasoned = await api(
      'POST',
      `/api/v1/purchase-requests/${id}/reject`,
      { reason: 'prices look stale' },
      approverToken,
    )
    expect(reasoned.statusCode).toBe(200)
  })

  it('computes the estimate at creation', async () => {
    const res = await api('POST', '/api/v1/purchase-requests', {
      projectId,
      currency: 'SAR',
      lines: [{ materialId, quantity: '70', uom: 'box', estimatedUnitPrice: '79.2000' }],
    })
    // 70 × 79.20 = 5544.00
    expect(res.json<{ totalEstimated: string }>().totalEstimated).toBe('5544.00')
  })
})

describe('converting to an order', () => {
  it('creates a draft PO with derived money and marks the request converted', async () => {
    const requestId = await approvedRequest()
    const lines = await runWithoutTenantScope(sys, () =>
      raw.purchaseRequestLine.findMany({ where: { requestId } }),
    )

    const res = await api('POST', `/api/v1/purchase-requests/${requestId}/convert`, {
      supplierId,
      taxAmount: '831.60',
      lines: [{ requestLineId: lines[0]!.id, unitPrice: '79.2000' }],
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ subtotal: string; total: string }>()
    expect(body.subtotal).toBe('5544.00')
    expect(body.total).toBe('6375.60')

    const request = await runWithoutTenantScope(sys, () =>
      raw.purchaseRequest.findFirst({ where: { id: requestId } }),
    )
    expect(request?.status).toBe('converted')
  })

  it('refuses to convert an unapproved request', async () => {
    const id = await createRequest()
    const lines = await runWithoutTenantScope(sys, () =>
      raw.purchaseRequestLine.findMany({ where: { requestId: id } }),
    )
    const res = await api('POST', `/api/v1/purchase-requests/${id}/convert`, {
      supplierId,
      lines: [{ requestLineId: lines[0]!.id, unitPrice: '79.2000' }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('INVALID_REQUEST_TRANSITION')
  })
})

describe('receiving into the ledger', () => {
  it('books the receipt as purchase_receipt movements in the base unit', async () => {
    const { poId, poLineId } = await issuedOrder()

    const res = await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, {
      unitId,
      clientEventId: randomUUID(),
      lines: [{ poLineId, quantity: '50' }],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<{ postedMovements: number; orderStatus: string }>()).toMatchObject({
      postedMovements: 1,
      orderStatus: 'partially_received',
    })

    const movements = await runWithoutTenantScope(sys, () => raw.stockMovement.findMany({}))
    expect(movements).toHaveLength(1)
    // 50 boxes × 1.44 = 72 m², cost 50 × 79.20 = 3960.00 — converted and
    // pro-rated by the modules that own those calculations.
    expect(movements[0]).toMatchObject({ type: 'purchase_receipt', direction: 'in' })
    expect(String(movements[0]?.quantity)).toBe('72')
    expect(String(movements[0]?.totalCost)).toBe('3960')

    const balances = await api('GET', `/api/v1/units/${unitId}/material-balances`)
    const [balance] = balances.json<{ data: { remainingQuantity: string; uom: string }[] }>().data
    expect(balance).toMatchObject({ remainingQuantity: '72.0000', uom: 'm2' })
  })

  it('settles the order to received when everything lands', async () => {
    const { poId, poLineId } = await issuedOrder()
    const res = await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, {
      unitId,
      clientEventId: randomUUID(),
      lines: [{ poLineId, quantity: '70' }],
    })
    expect(res.json<{ orderStatus: string }>().orderStatus).toBe('received')
  })

  it('refuses over-receipt beyond the 2% tolerance', async () => {
    const { poId, poLineId } = await issuedOrder()
    const res = await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, {
      unitId,
      clientEventId: randomUUID(),
      lines: [{ poLineId, quantity: '72' }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RECEIPT_EXCEEDS_ORDER')

    // And nothing reached the ledger.
    const movements = await runWithoutTenantScope(sys, () => raw.stockMovement.count())
    expect(movements).toBe(0)
  })

  it('acknowledges a duplicate receipt without double-booking stock', async () => {
    const { poId, poLineId } = await issuedOrder()
    const clientEventId = randomUUID()
    const payload = { unitId, clientEventId, lines: [{ poLineId, quantity: '50' }] }

    expect(
      (await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, payload)).statusCode,
    ).toBe(201)
    const retry = await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, payload)
    expect(retry.statusCode).toBe(200)
    expect(retry.json<{ duplicate: boolean }>().duplicate).toBe(true)

    const movements = await runWithoutTenantScope(sys, () => raw.stockMovement.count())
    expect(movements).toBe(1)
  })

  it('refuses receipts against an unissued order', async () => {
    const requestId = await approvedRequest()
    const lines = await runWithoutTenantScope(sys, () =>
      raw.purchaseRequestLine.findMany({ where: { requestId } }),
    )
    const convert = await api('POST', `/api/v1/purchase-requests/${requestId}/convert`, {
      supplierId,
      lines: [{ requestLineId: lines[0]!.id, unitPrice: '79.2000' }],
    })
    const poId = convert.json<{ id: string }>().id
    const poLines = await runWithoutTenantScope(sys, () =>
      raw.purchaseOrderLine.findMany({ where: { poId } }),
    )

    const res = await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, {
      unitId,
      clientEventId: randomUUID(),
      lines: [{ poLineId: poLines[0]!.id, quantity: '10' }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('ORDER_NOT_RECEIVABLE')
  })
})

describe('reading an order back', () => {
  it('returns the order with lines and its receipts', async () => {
    const { poId, poLineId } = await issuedOrder()
    await api('POST', `/api/v1/purchase-orders/${poId}/receipts`, {
      unitId,
      clientEventId: randomUUID(),
      lines: [{ poLineId, quantity: '30' }],
    })

    const res = await api('GET', `/api/v1/purchase-orders/${poId}`)
    const body = res.json<{
      status: string
      lines: { receivedQuantity: string }[]
      receipts: { receiptNumber: string; lines: unknown[] }[]
    }>()
    expect(body.status).toBe('partially_received')
    expect(body.lines[0]?.receivedQuantity).toBe('30.0000')
    expect(body.receipts).toHaveLength(1)
    expect(body.receipts[0]?.receiptNumber).toMatch(/^GR-/)
  })
})
