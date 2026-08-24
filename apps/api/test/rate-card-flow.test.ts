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
 * Rate cards over HTTP: the draft → active → archived pricing discipline,
 * deterministic resolution by pricing date and city, and the idempotent
 * regional starter seed.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string

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

const ITEM = {
  workItemCode: 'wk_paint_walls',
  descriptionEn: 'Wall painting',
  descriptionAr: 'دهان جدران',
  uom: 'm2',
  materialRate: '9.5000',
  labourRate: '8.0000',
  productivityPerDay: '45',
}

let cardCounter = 0

/** Creates a card, fills one item, activates. Returns its id. */
const activeCard = async (over: Record<string, unknown> = {}): Promise<string> => {
  cardCounter += 1
  const created = await api('POST', '/api/v1/rate-cards', {
    name: `Card ${String(cardCounter)}`,
    countryCode: 'SA',
    currency: 'SAR',
    effectiveFrom: '2026-01-01',
    ...over,
  })
  expect(created.statusCode).toBe(201)
  const id = created.json<{ id: string }>().id

  expect((await api('PUT', `/api/v1/rate-cards/${id}/items`, { items: [ITEM] })).statusCode).toBe(
    200,
  )
  expect((await api('POST', `/api/v1/rate-cards/${id}/activate`)).statusCode).toBe(200)
  return id
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
  cardCounter = 0
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)

  await runWithoutTenantScope(sys, async () => {
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
        slug: `acme-rc-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-rc-${String(Date.now())}@acme.sa`
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

describe('the pricing discipline', () => {
  it('items are editable in draft and frozen on activation', async () => {
    const created = await api('POST', '/api/v1/rate-cards', {
      name: 'Freeze test',
      countryCode: 'SA',
      currency: 'SAR',
      effectiveFrom: '2026-01-01',
    })
    const id = created.json<{ id: string }>().id

    const filled = await api('PUT', `/api/v1/rate-cards/${id}/items`, { items: [ITEM] })
    expect(filled.statusCode).toBe(200)
    expect(filled.json<{ itemCount: number }>().itemCount).toBe(1)

    await api('POST', `/api/v1/rate-cards/${id}/activate`)

    const edit = await api('PUT', `/api/v1/rate-cards/${id}/items`, {
      items: [{ ...ITEM, labourRate: '9' }],
    })
    expect(edit.statusCode).toBe(400)
    expect(edit.json<{ code: string }>().code).toBe('RATE_CARD_NOT_DRAFT')
  })

  it('an empty card cannot activate; a duplicate name cannot exist', async () => {
    const created = await api('POST', '/api/v1/rate-cards', {
      name: 'Empty',
      countryCode: 'SA',
      currency: 'SAR',
      effectiveFrom: '2026-01-01',
    })
    const id = created.json<{ id: string }>().id
    const activated = await api('POST', `/api/v1/rate-cards/${id}/activate`)
    expect(activated.statusCode).toBe(400)
    expect(activated.json<{ code: string }>().code).toBe('RATE_CARD_NEEDS_ITEMS')

    const duplicate = await api('POST', '/api/v1/rate-cards', {
      name: 'Empty',
      countryCode: 'SA',
      currency: 'SAR',
      effectiveFrom: '2026-01-01',
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json<{ code: string }>().code).toBe('RATE_CARD_NAME_TAKEN')
  })

  it('rates persist at 4 dp and read back through the snapshot', async () => {
    const id = await activeCard()
    const res = await api('GET', `/api/v1/rate-cards/${id}`)
    expect(res.statusCode).toBe(200)
    const snapshot = res.json<{ status: string; items: { materialRate: string }[] }>()
    expect(snapshot.status).toBe('active')
    expect(snapshot.items[0]).toMatchObject({ materialRate: '9.5000', labourRate: '8.0000' })
  })
})

describe('resolution by pricing date', () => {
  it('picks the card whose window covers the date — never "now"', async () => {
    // 2026 H1 card, superseded by a H2 card with different rates.
    const h1 = await activeCard({
      name: 'H1 2026',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
    })
    const h2 = await activeCard({ name: 'H2 2026', effectiveFrom: '2026-07-01' })

    const march = await api('GET', '/api/v1/rate-cards/resolve?date=2026-03-15')
    expect(march.statusCode).toBe(200)
    expect(march.json<{ card: { id: string } }>().card.id).toBe(h1)

    const august = await api('GET', '/api/v1/rate-cards/resolve?date=2026-08-15')
    expect(august.json<{ card: { id: string } }>().card.id).toBe(h2)

    const past = await api('GET', '/api/v1/rate-cards/resolve?date=2025-01-01')
    expect(past.statusCode).toBe(404)
    expect(past.json<{ code: string }>().code).toBe('RATE_CARD_NONE_EFFECTIVE')
  })

  it('prefers the city card where one exists', async () => {
    const country = await activeCard({ name: 'Countrywide', isDefault: true })
    const jeddah = await activeCard({ name: 'Jeddah rates', city: 'Jeddah' })

    const inJeddah = await api('GET', '/api/v1/rate-cards/resolve?date=2026-03-01&city=Jeddah')
    expect(inJeddah.json<{ card: { id: string } }>().card.id).toBe(jeddah)

    const elsewhere = await api('GET', '/api/v1/rate-cards/resolve?date=2026-03-01&city=Riyadh')
    expect(elsewhere.json<{ card: { id: string } }>().card.id).toBe(country)
  })

  it('an archived card stays readable but never resolves', async () => {
    const id = await activeCard()
    await api('POST', `/api/v1/rate-cards/${id}/archive`)

    expect((await api('GET', `/api/v1/rate-cards/${id}`)).statusCode).toBe(200)
    expect((await api('GET', '/api/v1/rate-cards/resolve?date=2026-03-01')).statusCode).toBe(404)
  })
})

describe('the regional starter', () => {
  it('seeds once, idempotently, active and resolvable', async () => {
    const first = await api('POST', '/api/v1/rate-cards/seed-regional')
    expect(first.statusCode).toBe(200)
    const seeded = first.json<{ id: string; created: boolean }>()
    expect(seeded.created).toBe(true)

    const again = await api('POST', '/api/v1/rate-cards/seed-regional')
    expect(again.json<{ id: string; created: boolean }>()).toMatchObject({
      id: seeded.id,
      created: false,
    })

    const resolved = await api('GET', '/api/v1/rate-cards/resolve?date=2026-08-24')
    expect(resolved.statusCode).toBe(200)
    const body = resolved.json<{
      card: { id: string; currency: string }
      items: { workItemCode: string }[]
    }>()
    expect(body.card.id).toBe(seeded.id)
    expect(body.card.currency).toBe('SAR')
    expect(body.items.length).toBeGreaterThanOrEqual(12)
    expect(body.items.map((item) => item.workItemCode)).toContain('wk_plumbing_point')
  })
})
