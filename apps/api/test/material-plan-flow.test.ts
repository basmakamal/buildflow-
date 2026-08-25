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
 * The loop closing: an approved BOQ issues the material plan, the plan fills
 * the `planned_quantity` the balance projection has carried empty since Phase
 * 3, a budget baseline is stamped from the same document, and shortage
 * detection — deferred for exactly this dependency — finally has something to
 * detect against.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let unitId: string
let materialId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
  }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
}

/**
 * An approved BOQ with one material line: 100 m² + 10 % waste = 110 planned,
 * at 50.00 material and 20.00 labour — every number below is hand-checkable.
 */
const approvedBoq = async (): Promise<string> => {
  const created = await api('POST', `/api/v1/units/${unitId}/boqs`, {
    name: 'Unit 305',
    pricingDate: '2026-08-01',
    overheadPercentage: '10',
  })
  expect(created.statusCode, created.body).toBe(201)
  const boqId = created.json<{ id: string }>().id

  const section = await api('POST', `/api/v1/boqs/${boqId}/sections`, {
    code: 'flooring',
    titleEn: 'Flooring',
    titleAr: 'الأرضيات',
  })
  const sectionId = section.json<{ sectionId: string }>().sectionId

  const line = await api('POST', `/api/v1/boqs/${boqId}/lines`, {
    sectionId,
    source: 'manual',
    workItemCode: 'wk_hand_checked',
    materialId,
    descriptionEn: 'Porcelain flooring',
    descriptionAr: 'أرضيات بورسلين',
    uom: 'm2',
    quantity: '100',
    wasteFactor: '10',
    materialRate: '50',
    labourRate: '20',
  })
  expect(line.statusCode, line.body).toBe(201)

  // A second line with no material: work, not stock — must be reported.
  await api('POST', `/api/v1/boqs/${boqId}/lines`, {
    sectionId,
    source: 'manual',
    workItemCode: 'wk_labour_only',
    descriptionEn: 'Site cleaning',
    descriptionAr: 'تنظيف الموقع',
    uom: 'm2',
    quantity: '100',
    labourRate: '5',
  })

  await api('POST', `/api/v1/boqs/${boqId}/submit`)
  expect((await api('POST', `/api/v1/boqs/${boqId}/approve`)).statusCode).toBe(200)
  return boqId
}

/** Records a consumption so the ledger has something to say. */
const consume = async (quantity: string): Promise<void> => {
  const res = await api('POST', '/api/v1/stock-movements', {
    materialId,
    unitId,
    type: 'consumption',
    quantity,
    uom: 'm2',
    clientEventId: ids.next(),
  })
  expect(res.statusCode, res.body).toBe(201)
}

const receive = async (quantity: string): Promise<void> => {
  const res = await api('POST', '/api/v1/stock-movements', {
    materialId,
    unitId,
    type: 'purchase_receipt',
    quantity,
    uom: 'm2',
    clientEventId: ids.next(),
  })
  expect(res.statusCode, res.body).toBe(201)
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
    await raw.materialPlan.deleteMany({})
    await raw.quotation.deleteMany({})
    await raw.packageItem.deleteMany({})
    await raw.finishingPackage.deleteMany({})
    await raw.boqLine.deleteMany({})
    await raw.boqSection.deleteMany({})
    await raw.boq.deleteMany({})
    await raw.rateCardItem.deleteMany({})
    await raw.rateCard.deleteMany({})
    await raw.$executeRaw`DELETE FROM kb_estimation_standards WHERE company_id IS NOT NULL`
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
        slug: `acme-mp-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitId = ids.next()
    materialId = ids.next()

    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'MP-1',
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

    const category = await raw.materialCategory.upsert({
      where: { code: 'mp-tiles' },
      create: { code: 'mp-tiles', nameEn: 'Tiles', nameAr: 'بلاط' },
      update: {},
    })
    await raw.material.create({
      data: {
        id: materialId,
        companyId: COMPANY,
        categoryId: category.id,
        sku: 'POR-60',
        nameEn: 'Porcelain 60x60',
        nameAr: 'بورسلين ٦٠×٦٠',
        baseUom: 'm2',
      },
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-mp-${String(Date.now())}@acme.sa`
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

  expect((await api('POST', '/api/v1/rate-cards/seed-regional')).statusCode).toBe(200)
})

describe('issuing the plan', () => {
  it('writes the plan, fills the projection, and stamps the baseline', async () => {
    const boqId = await approvedBoq()

    const issued = await api('POST', `/api/v1/boqs/${boqId}/issue-material-plan`)
    expect(issued.statusCode, issued.body).toBe(201)
    const result = issued.json<{
      planRowsWritten: number
      alreadyIssued: boolean
      unplannable: { workItemCode: string }[]
      budget: { revision: number; totalBudget: string } | null
    }>()

    expect(result.planRowsWritten).toBe(1)
    expect(result.alreadyIssued).toBe(false)
    // The labour-only line is reported, not silently dropped.
    expect(result.unplannable).toHaveLength(1)
    expect(result.unplannable[0]!.workItemCode).toBe('wk_labour_only')

    // material 110 × 50 = 5,500; labour 110 × 20 + 100 × 5 = 2,700;
    // works subtotal 8,200 + 10 % overhead = 820 → baseline 9,020.
    expect(result.budget).toMatchObject({ revision: 1, totalBudget: '9020.00' })

    const plan = await api('GET', `/api/v1/units/${unitId}/material-plan`)
    expect(plan.json<{ data: { plannedQuantity: string }[] }>().data[0]).toMatchObject({
      plannedQuantity: '110.0000',
      plannedUnitCost: '50.0000',
    })

    // The projection now knows what was PLANNED — the half that was missing.
    const balance = await runWithoutTenantScope(sys, () =>
      raw.materialBalance.findFirstOrThrow({ where: { unitId, materialId } }),
    )
    expect(Number(balance.plannedQuantity)).toBe(110)
    expect(Number(balance.plannedCost)).toBe(5500)
  })

  it('is idempotent — the button someone presses twice', async () => {
    const boqId = await approvedBoq()
    await api('POST', `/api/v1/boqs/${boqId}/issue-material-plan`)

    const again = await api('POST', `/api/v1/boqs/${boqId}/issue-material-plan`)
    expect(again.statusCode).toBe(201)
    expect(again.json<{ planRowsWritten: number; alreadyIssued: boolean }>()).toMatchObject({
      planRowsWritten: 0,
      alreadyIssued: true,
    })

    const rows = await runWithoutTenantScope(sys, () => raw.materialPlan.count())
    expect(rows).toBe(1)

    // The plan did not double, so neither did the projection.
    const balance = await runWithoutTenantScope(sys, () =>
      raw.materialBalance.findFirstOrThrow({ where: { unitId, materialId } }),
    )
    expect(Number(balance.plannedQuantity)).toBe(110)
  })

  it('refuses a BOQ that is not approved', async () => {
    const created = await api('POST', `/api/v1/units/${unitId}/boqs`, {
      name: 'Draft',
      pricingDate: '2026-08-01',
    })
    const boqId = created.json<{ id: string }>().id
    const res = await api('POST', `/api/v1/boqs/${boqId}/issue-material-plan`)
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('BOQ_NOT_APPROVED')
  })
})

describe('shortage detection, unblocked at last', () => {
  it('is silent while the site can still finish', async () => {
    const boqId = await approvedBoq()
    await api('POST', `/api/v1/boqs/${boqId}/issue-material-plan`)
    await receive('120')

    const res = await api('GET', `/api/v1/units/${unitId}/shortages`)
    expect(res.statusCode).toBe(200)
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(0)
  })

  it('names the shortfall between what is still needed and what is on site', async () => {
    const boqId = await approvedBoq()
    await api('POST', `/api/v1/boqs/${boqId}/issue-material-plan`)
    // 80 delivered, 60 consumed → 20 on site; 110 planned − 60 used = 50 still
    // needed, so the job is 30 short of finishing.
    await receive('80')
    await consume('60')

    const res = await api('GET', `/api/v1/units/${unitId}/shortages`)
    const shortages = res.json<{
      data: { materialSku: string; stillNeeded: string; available: string; shortfall: string }[]
    }>().data
    expect(shortages).toHaveLength(1)
    expect(shortages[0]).toMatchObject({
      materialSku: 'POR-60',
      stillNeeded: '50.0000',
      available: '20.0000',
      shortfall: '30.0000',
    })
  })

  it('says nothing about material nobody planned', async () => {
    // Stock movements without an issued plan: no promise, so nothing missing.
    await receive('10')
    await consume('5')
    const res = await api('GET', `/api/v1/units/${unitId}/shortages`)
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(0)
  })
})
