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
 * The stock ledger over HTTP.
 *
 * What these tests defend: the ledger is append-only (corrections are
 * reversals), duplicates from the offline outbox are acknowledged rather than
 * re-applied, quantities land in the material's base unit, and the balance
 * projection always equals a replay of the ledger.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const RIVAL = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let unitId: string
let materialId: string
let rivalMaterialId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const api = (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
  }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
}

interface Balance {
  materialId: string
  purchasedQuantity: string
  usedQuantity: string
  remainingQuantity: string
  actualCost: string
  uom: string
}

const balances = async (): Promise<Balance[]> =>
  (await api('GET', `/api/v1/units/${unitId}/material-balances`)).json<{ data: Balance[] }>().data

const record = (over: Record<string, unknown> = {}) =>
  api('POST', '/api/v1/stock-movements', {
    materialId,
    unitId,
    type: 'purchase_receipt',
    quantity: '100',
    uom: 'm2',
    totalCost: '5500.0000',
    currency: 'SAR',
    clientEventId: randomUUID(),
    ...over,
  })

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
    // Full teardown in foreign-key order — see catalogue-flow.test.ts on why
    // partial cleanup fails once suites run together.
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

    await raw.company.createMany({
      data: [
        {
          id: COMPANY,
          nameEn: 'Acme',
          nameAr: 'أكمي',
          slug: `acme-stk-${String(Date.now())}`,
          countryCode: 'SA',
          defaultCurrency: 'SAR',
        },
        {
          id: RIVAL,
          nameEn: 'Rival',
          nameAr: 'منافس',
          slug: `rival-stk-${String(Date.now())}`,
          countryCode: 'AE',
          defaultCurrency: 'AED',
        },
      ],
    })
  })

  await runWithoutTenantScope(sys, () => seedMaterialCategories(db, () => ids.next()))
  const category = await runWithoutTenantScope(sys, () =>
    raw.materialCategory.findFirst({ where: { code: 'flooring_porcelain' } }),
  )

  const projectId = ids.next()
  unitId = ids.next()
  materialId = ids.next()
  rivalMaterialId = ids.next()

  await runWithoutTenantScope(sys, async () => {
    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'STK-1',
        nameEn: 'S',
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
        defaultCost: '55.0000',
        currency: 'SAR',
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
    await raw.material.create({
      data: {
        id: rivalMaterialId,
        companyId: RIVAL,
        categoryId: category!.id,
        sku: 'RIVAL-1',
        nameEn: 'Rival Tile',
        nameAr: 'بلاط',
        baseUom: 'm2',
      },
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-stk-${String(Date.now())}@acme.sa`
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

describe('recording movements', () => {
  it('records a receipt and projects the balance', async () => {
    expect((await record()).statusCode).toBe(201)

    const [balance] = await balances()
    expect(balance?.purchasedQuantity).toBe('100.0000')
    expect(balance?.remainingQuantity).toBe('100.0000')
    expect(balance?.actualCost).toBe('5500.0000')
  })

  it('converts purchase units into the base unit before storing', async () => {
    const res = await record({ quantity: '10', uom: 'box', totalCost: null, currency: null })
    expect(res.statusCode).toBe(201)
    // 10 boxes × 1.44 = 14.40 m² — the ledger stores ONE unit per material.
    expect(res.json<{ quantityInBaseUom: string; uom: string }>()).toMatchObject({
      quantityInBaseUom: '14.4000',
      uom: 'm2',
    })
  })

  it('rejects a unit pairing the material does not define', async () => {
    const res = await record({ uom: 'roll' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('MATERIAL_CONVERSION_MISSING')
  })

  it('rejects a direction that contradicts the type', async () => {
    const res = await record({ type: 'consumption', direction: 'in' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('STOCK_DIRECTION_CONTRADICTS_TYPE')
  })

  /**
   * The offline outbox retries until acknowledged, so every movement WILL be
   * sent twice eventually. The duplicate must be acknowledged (200, original
   * id) and must NOT double the stock.
   */
  it('acknowledges a duplicate clientEventId without re-applying it', async () => {
    const clientEventId = randomUUID()
    const first = await record({ clientEventId })
    expect(first.statusCode).toBe(201)

    const retry = await record({ clientEventId })
    expect(retry.statusCode).toBe(200)
    expect(retry.json<{ duplicate: boolean }>().duplicate).toBe(true)

    const [balance] = await balances()
    expect(balance?.remainingQuantity).toBe('100.0000')
  })

  it('404s a material belonging to another tenant', async () => {
    const res = await record({ materialId: rivalMaterialId })
    expect(res.statusCode).toBe(404)
  })
})

describe('consumption and the balance story', () => {
  it('tracks purchased/used/remaining through a realistic sequence', async () => {
    await record({ quantity: '100' })
    await record({ type: 'consumption', quantity: '35.5', totalCost: null, currency: null })
    await record({ type: 'wastage', quantity: '2.25', totalCost: null, currency: null })

    const [balance] = await balances()
    expect(balance).toMatchObject({
      purchasedQuantity: '100.0000',
      usedQuantity: '35.5000',
      remainingQuantity: '62.2500',
    })
  })
})

describe('reversals', () => {
  const lastMovementId = async (): Promise<string> => {
    const rows = (await api('GET', `/api/v1/units/${unitId}/stock-movements`)).json<{
      data: { id: string }[]
    }>().data
    return rows[0]!.id
  }

  it('reverses a consumption and restores both remaining and used', async () => {
    await record({ quantity: '100' })
    await record({ type: 'consumption', quantity: '30', totalCost: null, currency: null })
    const consumptionId = await lastMovementId()

    const res = await api('POST', `/api/v1/stock-movements/${consumptionId}/reverse`, {
      clientEventId: randomUUID(),
    })
    expect(res.statusCode).toBe(201)

    const [balance] = await balances()
    // Not an adjustment: the reversal keeps the original's TYPE, so the
    // consumption story is corrected, not papered over.
    expect(balance?.usedQuantity).toBe('0.0000')
    expect(balance?.remainingQuantity).toBe('100.0000')
  })

  it('refuses to reverse twice', async () => {
    await record({ quantity: '100' })
    const id = await lastMovementId()

    expect(
      (await api('POST', `/api/v1/stock-movements/${id}/reverse`, { clientEventId: randomUUID() }))
        .statusCode,
    ).toBe(201)
    const second = await api('POST', `/api/v1/stock-movements/${id}/reverse`, {
      clientEventId: randomUUID(),
    })
    expect(second.statusCode).toBe(409)
    expect(second.json<{ code: string }>().code).toBe('STOCK_ALREADY_REVERSED')
  })

  it('refuses to reverse a reversal', async () => {
    await record({ quantity: '100' })
    const originalId = await lastMovementId()
    await api('POST', `/api/v1/stock-movements/${originalId}/reverse`, {
      clientEventId: randomUUID(),
    })
    const reversalId = await lastMovementId()

    const res = await api('POST', `/api/v1/stock-movements/${reversalId}/reverse`, {
      clientEventId: randomUUID(),
    })
    expect(res.statusCode).toBe(422)
    expect(res.json<{ code: string }>().code).toBe('STOCK_CANNOT_REVERSE_REVERSAL')
  })
})

describe('the ledger', () => {
  it('lists movements newest first, with reversal linkage visible', async () => {
    await record({ quantity: '100' })
    const id = await lastId()
    await api('POST', `/api/v1/stock-movements/${id}/reverse`, { clientEventId: randomUUID() })

    const rows = (await api('GET', `/api/v1/units/${unitId}/stock-movements`)).json<{
      data: { type: string; direction: string; reversalOfMovementId: string | null }[]
    }>().data

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      type: 'purchase_receipt',
      direction: 'out',
      reversalOfMovementId: id,
    })
  })

  const lastId = async (): Promise<string> =>
    (await api('GET', `/api/v1/units/${unitId}/stock-movements`)).json<{ data: { id: string }[] }>()
      .data[0]!.id
})
