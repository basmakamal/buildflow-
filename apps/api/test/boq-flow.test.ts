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
 * The whole BOQ journey over HTTP: created against the rate card the pricing
 * date resolves, quantified by a rule WITH its provenance, corrected in
 * review with a reason, approved into immutability, superseded by the next
 * version's approval — and diffed, so the reviewer sees what moved.
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

/** Creates a draft BOQ against the seeded regional card, with one section. */
const draftBoq = async (): Promise<{ boqId: string; sectionId: string }> => {
  const created = await api('POST', `/api/v1/units/${unitId}/boqs`, {
    name: 'Unit 305 · Premium',
    pricingDate: '2026-08-01',
    taxPercentage: '15',
  })
  expect(created.statusCode).toBe(201)
  const boqId = created.json<{ id: string }>().id

  const section = await api('POST', `/api/v1/boqs/${boqId}/sections`, {
    code: 'painting',
    titleEn: 'Painting',
    titleAr: 'الدهانات',
  })
  expect(section.statusCode).toBe(201)
  return { boqId, sectionId: section.json<{ sectionId: string }>().sectionId }
}

/** The canonical rule line: paintable wall area priced as wk_paint_walls. */
const addRuleLine = async (boqId: string, sectionId: string): Promise<string> => {
  const res = await api('POST', `/api/v1/boqs/${boqId}/lines`, {
    sectionId,
    source: 'rule',
    workItemCode: 'wk_paint_walls',
    ruleCode: 'est_paint_wall_area',
    roomId: null,
    inputs: { perimeter_m: '24', height_m: '3', openings_m2: '4.2' },
  })
  expect(res.statusCode, res.body).toBe(201)
  return res.json<{ lineId: string }>().lineId
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
        slug: `acme-boq-${String(Date.now())}`,
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
        code: 'BOQ-1',
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

  const email = `owner-boq-${String(Date.now())}@acme.sa`
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

  // The pricing side: the regional starter card (wk_paint_walls at 9.50/8.00).
  expect((await api('POST', '/api/v1/rate-cards/seed-regional')).statusCode).toBe(200)
})

describe('creation and pricing', () => {
  it('binds the rate card the pricing date resolves, never "now"', async () => {
    const created = await api('POST', `/api/v1/units/${unitId}/boqs`, {
      name: 'V1',
      pricingDate: '2026-08-01',
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<{ versionNumber: number; currency: string }>()).toMatchObject({
      versionNumber: 1,
      currency: 'SAR',
    })

    // A date before every card's window has no price basis at all.
    const before = await api('POST', `/api/v1/units/${unitId}/boqs`, {
      name: 'Too early',
      pricingDate: '2025-01-01',
    })
    expect(before.statusCode).toBe(404)
    expect(before.json<{ code: string }>().code).toBe('RATE_CARD_NONE_EFFECTIVE')
  })

  it('prices a rule line from the card and stamps the provenance', async () => {
    const { boqId, sectionId } = await draftBoq()
    const lineId = await addRuleLine(boqId, sectionId)

    const snapshot = await api('GET', `/api/v1/boqs/${boqId}`)
    const body = snapshot.json<{
      subtotal: string
      grandTotal: string
      lines: {
        id: string
        quantity: string
        formulaEvaluated: string
        formulaInputs: Record<string, string>
        materialRate: string
        lineTotal: string
        source: string
      }[]
    }>()
    const line = body.lines.find((candidate) => candidate.id === lineId)!
    // 24×3 − 4.2 = 67.8 m²; 67.8 × (9.50+8.00) = 1186.50
    expect(line).toMatchObject({
      source: 'rule',
      quantity: '67.8000',
      materialRate: '9.5000',
      lineTotal: '1186.50',
      formulaEvaluated: 'perimeter_m(24) * height_m(3) - openings_m2(4.2) = 67.8000',
    })
    expect(line.formulaInputs).toEqual({ perimeter_m: '24', height_m: '3', openings_m2: '4.2' })
    expect(body.subtotal).toBe('1186.50')
    // +15% VAT = 1364.48 (rounded once)
    expect(body.grandTotal).toBe('1364.48')
  })

  it('a rule line for a work item the card does not price is refused', async () => {
    const { boqId, sectionId } = await draftBoq()
    const res = await api('POST', `/api/v1/boqs/${boqId}/lines`, {
      sectionId,
      source: 'rule',
      workItemCode: 'wk_not_in_card',
      ruleCode: 'est_paint_wall_area',
      inputs: { perimeter_m: '24', height_m: '3', openings_m2: '0' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('BOQ_RATE_ITEM_MISSING')
  })

  it('an explicit rate card must cover the pricing date', async () => {
    const cardId = (await api('GET', '/api/v1/rate-cards')).json<{ data: { id: string }[] }>()
      .data[0]!.id
    const res = await api('POST', `/api/v1/units/${unitId}/boqs`, {
      name: 'Mispriced',
      pricingDate: '2025-06-01',
      rateCardId: cardId,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RATE_CARD_NOT_EFFECTIVE')
  })
})

describe('review, approval, immutability', () => {
  it('walks the life: correct in review with a reason, approve, freeze', async () => {
    const { boqId, sectionId } = await draftBoq()
    const lineId = await addRuleLine(boqId, sectionId)

    expect((await api('POST', `/api/v1/boqs/${boqId}/submit`)).statusCode).toBe(200)

    // Review is where the QS overrules the formula — with the honest reason.
    const overridden = await api('PUT', `/api/v1/boqs/${boqId}/lines/${lineId}/override`, {
      quantity: '70',
      reason: 'Site measurement: alcove the plan does not show',
    })
    expect(overridden.statusCode).toBe(200)
    // 70 × 17.50 = 1225.00
    expect(overridden.json<{ lineTotal: string }>().lineTotal).toBe('1225.00')

    const approved = await api('POST', `/api/v1/boqs/${boqId}/approve`)
    expect(approved.statusCode).toBe(200)
    expect(approved.json<{ status: string }>().status).toBe('approved')

    // Frozen: no new lines, no overrides.
    const addAfter = await api('POST', `/api/v1/boqs/${boqId}/lines`, {
      sectionId,
      source: 'manual',
      workItemCode: 'wk_paint_walls',
      quantity: '1',
    })
    expect(addAfter.statusCode).toBe(400)
    expect(addAfter.json<{ code: string }>().code).toBe('BOQ_NOT_DRAFT')

    const overrideAfter = await api('PUT', `/api/v1/boqs/${boqId}/lines/${lineId}/override`, {
      quantity: '60',
      reason: 'attempt on frozen document',
    })
    expect(overrideAfter.statusCode).toBe(400)
    expect(overrideAfter.json<{ code: string }>().code).toBe('BOQ_NOT_EDITABLE')
  })

  it('an override without a reason never lands', async () => {
    const { boqId, sectionId } = await draftBoq()
    const lineId = await addRuleLine(boqId, sectionId)
    const res = await api('PUT', `/api/v1/boqs/${boqId}/lines/${lineId}/override`, {
      quantity: '70',
      reason: ' ',
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('versioning and diff', () => {
  it('the next version supersedes the old one only on ITS approval', async () => {
    const { boqId, sectionId } = await draftBoq()
    await addRuleLine(boqId, sectionId)
    await api('POST', `/api/v1/boqs/${boqId}/submit`)
    await api('POST', `/api/v1/boqs/${boqId}/approve`)

    const versioned = await api('POST', `/api/v1/boqs/${boqId}/versions`)
    expect(versioned.statusCode).toBe(201)
    const v2 = versioned.json<{ id: string; versionNumber: number; status: string }>()
    expect(v2).toMatchObject({ versionNumber: 2, status: 'draft' })

    // The old version is still THE approved BOQ while v2 is drafted.
    const v1While = await api('GET', `/api/v1/boqs/${boqId}`)
    expect(v1While.json<{ status: string }>().status).toBe('approved')

    // Change v2: override its copied line, then approve it.
    const v2Line = (await api('GET', `/api/v1/boqs/${v2.id}`)).json<{ lines: { id: string }[] }>()
      .lines[0]!.id
    await api('PUT', `/api/v1/boqs/${v2.id}/lines/${v2Line}/override`, {
      quantity: '75',
      reason: 'client added a partition wall',
    })
    await api('POST', `/api/v1/boqs/${v2.id}/submit`)
    const approved = await api('POST', `/api/v1/boqs/${v2.id}/approve`)
    expect(approved.json<{ superseded: string | null }>().superseded).toBe(boqId)

    const v1After = await api('GET', `/api/v1/boqs/${boqId}`)
    expect(v1After.json<{ status: string; supersededByBoqId: string }>()).toMatchObject({
      status: 'superseded',
      supersededByBoqId: v2.id,
    })

    // The diff names what moved and by how much.
    const diff = await api('GET', `/api/v1/boqs/${v2.id}/diff/${boqId}`)
    expect(diff.statusCode).toBe(200)
    const body = diff.json<{
      changed: {
        workItemCode: string
        before: { quantityWithWaste: string }
        after: { quantityWithWaste: string }
      }[]
      totals: { before: { subtotal: string }; after: { subtotal: string } }
    }>()
    expect(body.changed).toHaveLength(1)
    expect(body.changed[0]).toMatchObject({
      workItemCode: 'wk_paint_walls',
      before: { quantityWithWaste: '67.8000' },
      after: { quantityWithWaste: '75.0000' },
    })
    expect(body.totals.before.subtotal).toBe('1186.50')
    expect(body.totals.after.subtotal).toBe('1312.50')
  })

  it('lists every version of the unit, oldest first', async () => {
    const { boqId, sectionId } = await draftBoq()
    await addRuleLine(boqId, sectionId)
    await api('POST', `/api/v1/boqs/${boqId}/submit`)
    await api('POST', `/api/v1/boqs/${boqId}/approve`)
    await api('POST', `/api/v1/boqs/${boqId}/versions`)

    const list = await api('GET', `/api/v1/units/${unitId}/boqs`)
    const rows = list.json<{ data: { versionNumber: number; status: string }[] }>().data
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ versionNumber: 1, status: 'approved' })
    expect(rows[1]).toMatchObject({ versionNumber: 2, status: 'draft' })
  })
})
