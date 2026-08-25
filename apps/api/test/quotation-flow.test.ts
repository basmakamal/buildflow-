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
 * Quotations over HTTP: derived from an approved BOQ, the money chain ending
 * in tax on what is payable, the send/view/accept trail, and the bilingual
 * document served in either language regardless of which was sent.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let unitId: string

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
 * An approved BOQ whose pre-tax total is exactly 1000.00: one line of 100 m²
 * at a combined 10.00, no waste, plus 0 % overhead and 0 % profit — so the
 * quotation arithmetic below is checkable by hand.
 */
const approvedBoq = async (): Promise<{ boqId: string; preTaxTotal: string }> => {
  const created = await api('POST', `/api/v1/units/${unitId}/boqs`, {
    name: 'Unit 305',
    pricingDate: '2026-08-01',
  })
  expect(created.statusCode, created.body).toBe(201)
  const boqId = created.json<{ id: string }>().id

  const section = await api('POST', `/api/v1/boqs/${boqId}/sections`, {
    code: 'walls',
    titleEn: 'Walls',
    titleAr: 'الجدران',
  })
  const sectionId = section.json<{ sectionId: string }>().sectionId

  // Off-card line, so the rates are exactly what this test states.
  const line = await api('POST', `/api/v1/boqs/${boqId}/lines`, {
    sectionId,
    source: 'manual',
    workItemCode: 'wk_hand_checked',
    descriptionEn: 'Hand-checked works',
    descriptionAr: 'أعمال محسوبة يدويًا',
    uom: 'm2',
    quantity: '100',
    materialRate: '6',
    labourRate: '4',
  })
  expect(line.statusCode, line.body).toBe(201)

  await api('POST', `/api/v1/boqs/${boqId}/submit`)
  const approved = await api('POST', `/api/v1/boqs/${boqId}/approve`)
  expect(approved.statusCode).toBe(200)

  const snapshot = await api('GET', `/api/v1/boqs/${boqId}`)
  return { boqId, preTaxTotal: snapshot.json<{ preTaxTotal: string }>().preTaxTotal }
}

const quote = async (
  boqId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; totalAmount: string }> => {
  const res = await api('POST', '/api/v1/quotations', {
    boqId,
    validUntil: '2099-12-31',
    markupPercentage: '10',
    taxPercentage: '15',
    ...over,
  })
  expect(res.statusCode, res.body).toBe(201)
  return res.json<{ id: string; totalAmount: string }>()
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
        slug: `acme-quo-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitId = ids.next()
    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'QUO-1',
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

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-quo-${String(Date.now())}@acme.sa`
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

describe('deriving the offer', () => {
  it('quotes from the approved BOQ pre-tax total, taxing what is payable', async () => {
    const { boqId, preTaxTotal } = await approvedBoq()
    expect(preTaxTotal).toBe('1000.00')

    const res = await api('POST', '/api/v1/quotations', {
      boqId,
      validUntil: '2099-12-31',
      markupPercentage: '10',
      discountAmount: '100',
      taxPercentage: '15',
    })
    expect(res.statusCode, res.body).toBe(201)
    // 1000 + 10% = 1100; − 100 = 1000 net; 15% VAT = 150; payable 1150.
    expect(res.json()).toMatchObject({
      quotationNumber: 'QT-00001',
      status: 'draft',
      basisAmount: '1000.00',
      markupAmount: '100.00',
      netAmount: '1000.00',
      taxAmount: '150.00',
      totalAmount: '1150.00',
      currency: 'SAR',
    })
  })

  it('refuses to quote a BOQ that is not approved', async () => {
    const created = await api('POST', `/api/v1/units/${unitId}/boqs`, {
      name: 'Draft only',
      pricingDate: '2026-08-01',
    })
    const boqId = created.json<{ id: string }>().id

    const res = await api('POST', '/api/v1/quotations', { boqId, validUntil: '2099-12-31' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('BOQ_NOT_APPROVED')
  })

  it('refuses a discount larger than the offer', async () => {
    const { boqId } = await approvedBoq()
    const res = await api('POST', '/api/v1/quotations', {
      boqId,
      validUntil: '2099-12-31',
      discountAmount: '99999',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('QUOTATION_DISCOUNT_EXCEEDS_TOTAL')
  })
})

describe('send and track', () => {
  it('walks sent → viewed → accepted, stamping the trail', async () => {
    const { boqId } = await approvedBoq()
    const { id } = await quote(boqId)

    const sent = await api('POST', `/api/v1/quotations/${id}/send`, { documentId: null })
    expect(sent.statusCode).toBe(200)
    expect(sent.json<{ status: string; sentAt: string }>().status).toBe('sent')
    expect(sent.json<{ sentAt: string | null }>().sentAt).not.toBeNull()

    const viewed = await api('POST', `/api/v1/quotations/${id}/view`)
    expect(viewed.json<{ status: string }>().status).toBe('viewed')
    const firstView = viewed.json<{ viewedAt: string }>().viewedAt

    // A second open does not move the answer to "when did they look at it".
    const again = await api('POST', `/api/v1/quotations/${id}/view`)
    expect(again.json<{ viewedAt: string }>().viewedAt).toBe(firstView)

    const accepted = await api('POST', `/api/v1/quotations/${id}/accept`)
    expect(accepted.json<{ status: string }>().status).toBe('accepted')
    expect(accepted.json<{ respondedAt: string | null }>().respondedAt).not.toBeNull()

    // An accepted quotation is a commitment — it answers only once.
    const twice = await api('POST', `/api/v1/quotations/${id}/reject`)
    expect(twice.statusCode).toBe(400)
    expect(twice.json<{ code: string }>().code).toBe('QUOTATION_NOT_OPEN')
  })

  it('refuses to send an offer whose shelf life has already run out', async () => {
    const { boqId } = await approvedBoq()
    const { id } = await quote(boqId, { validUntil: '2020-01-01' })
    const res = await api('POST', `/api/v1/quotations/${id}/send`, {})
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('QUOTATION_ALREADY_EXPIRED')
  })

  it('expires an open offer once it is stale, and lists it by status', async () => {
    const { boqId } = await approvedBoq()
    const { id } = await quote(boqId)
    await api('POST', `/api/v1/quotations/${id}/send`, {})

    // Still valid: expiry is refused rather than quietly applied.
    const early = await api('POST', `/api/v1/quotations/${id}/expire`)
    expect(early.statusCode).toBe(400)
    expect(early.json<{ code: string }>().code).toBe('QUOTATION_STILL_VALID')

    const listed = await api('GET', `/api/v1/quotations?unitId=${unitId}&status=sent`)
    expect(listed.json<{ data: unknown[] }>().data).toHaveLength(1)
  })
})

describe('the bilingual document', () => {
  it('serves either language regardless of which one was sent', async () => {
    const { boqId } = await approvedBoq()
    const { id } = await quote(boqId, { language: 'ar', discountAmount: '100' })
    await api('POST', `/api/v1/quotations/${id}/send`, {})

    const arabic = await api('GET', `/api/v1/quotations/${id}/document`)
    expect(arabic.statusCode).toBe(200)
    const ar = arabic.json<{
      language: string
      direction: string
      header: { title: string }
      sections: { title: string; lines: { description: string; unitRate: string }[] }[]
      totals: { label: string; amount: string }[]
    }>()
    // Defaults to the language it was issued in.
    expect(ar.language).toBe('ar')
    expect(ar.direction).toBe('rtl')
    expect(ar.header.title).toBe('عرض سعر')
    expect(ar.sections[0]!.title).toBe('الجدران')
    expect(ar.sections[0]!.lines[0]!.description).toBe('أعمال محسوبة يدويًا')
    // One combined rate on the client's copy: 6.00 + 4.00.
    expect(ar.sections[0]!.lines[0]!.unitRate).toBe('10.0000')
    expect(ar.totals.at(-1)).toMatchObject({ label: 'الإجمالي المستحق', amount: '1150.00' })

    const english = await api('GET', `/api/v1/quotations/${id}/document?lang=en`)
    const en = english.json<{
      direction: string
      header: { title: string }
      totals: { label: string; amount: string }[]
    }>()
    expect(en.direction).toBe('ltr')
    expect(en.header.title).toBe('Quotation')
    // The same money, whichever language reads it.
    expect(en.totals.at(-1)).toMatchObject({ label: 'Total payable', amount: '1150.00' })
  })

  it('404s a quotation that does not exist', async () => {
    const res = await api('GET', `/api/v1/quotations/${ids.next()}/document`)
    expect(res.statusCode).toBe(404)
  })
})
