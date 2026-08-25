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
 * The sprint's headline over HTTP: a published package applied to a unit's
 * real rooms becomes a BOQ whose every line carries its formula, and the
 * comparison view prices three tiers against those same rooms through the
 * same code path — so what a client is shown and what the seller generates
 * cannot drift.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let unitId: string
let bedroomId: string
let bathroomId: string

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

/** Wall painting everywhere (rule-driven) + one fixed sanitary set per bathroom. */
const STANDARD_ITEMS = [
  {
    element: 'wall',
    workItemCode: 'wk_paint_walls',
    ruleCode: 'est_paint_wall_area',
    specTextEn: 'Matt emulsion',
  },
  {
    element: 'floor',
    roomTypeCode: 'bedroom',
    workItemCode: 'wk_floor_porcelain',
    ruleCode: 'est_tile_area',
  },
  {
    element: 'sanitary',
    roomTypeCode: 'bathroom',
    workItemCode: 'wk_plumbing_point',
    fixedQuantity: '3',
  },
]

const createPackage = async (
  code: string,
  items: unknown[] = STANDARD_ITEMS,
  over: Record<string, unknown> = {},
): Promise<string> => {
  const created = await api('POST', '/api/v1/packages', {
    code,
    nameEn: code,
    nameAr: code,
    tier: 'standard',
    currency: 'SAR',
    ...over,
  })
  expect(created.statusCode, created.body).toBe(201)
  const packageId = created.json<{ id: string }>().id

  const filled = await api('PUT', `/api/v1/packages/${packageId}/items`, { items })
  expect(filled.statusCode, filled.body).toBe(200)
  return packageId
}

const publish = async (packageId: string): Promise<void> => {
  const res = await api('POST', `/api/v1/packages/${packageId}/publish`)
  expect(res.statusCode, res.body).toBe(200)
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
        slug: `acme-pkg-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitId = ids.next()
    bedroomId = ids.next()
    bathroomId = ids.next()

    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'PKG-1',
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
    // A bedroom and a bathroom: enough for typed and untyped items to differ.
    await raw.room.createMany({
      data: [
        {
          id: bedroomId,
          companyId: COMPANY,
          unitId,
          typeCode: 'bedroom',
          nameEn: 'Bedroom 1',
          nameAr: 'غرفة نوم ١',
          widthMm: 4000,
          lengthMm: 5000,
          heightMm: 3000,
          floorArea: '20',
          wallArea: '54',
          ceilingArea: '20',
          perimeter: '18',
          sortOrder: 0,
        },
        {
          id: bathroomId,
          companyId: COMPANY,
          unitId,
          typeCode: 'bathroom',
          nameEn: 'Bathroom',
          nameAr: 'دورة مياه',
          widthMm: 2000,
          lengthMm: 3000,
          heightMm: 3000,
          floorArea: '6',
          wallArea: '30',
          ceilingArea: '6',
          perimeter: '10',
          sortOrder: 1,
        },
      ],
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-pkg-${String(Date.now())}@acme.sa`
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

describe('definition and publication', () => {
  it('refuses two specifications for the same element in the same rooms', async () => {
    const created = await api('POST', '/api/v1/packages', {
      code: 'clashing',
      nameEn: 'Clashing',
      nameAr: 'متعارض',
      tier: 'standard',
      currency: 'SAR',
    })
    const packageId = created.json<{ id: string }>().id
    const res = await api('PUT', `/api/v1/packages/${packageId}/items`, {
      items: [
        { element: 'wall', workItemCode: 'wk_paint_walls', ruleCode: 'est_paint_wall_area' },
        { element: 'wall', workItemCode: 'wk_plaster_walls', ruleCode: 'est_paint_wall_area' },
      ],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('PACKAGE_ITEM_DUPLICATE')
  })

  it('freezes items on publication and versions into a fresh draft', async () => {
    const packageId = await createPackage('premium_v1')
    await publish(packageId)

    const edit = await api('PUT', `/api/v1/packages/${packageId}/items`, { items: STANDARD_ITEMS })
    expect(edit.statusCode).toBe(400)
    expect(edit.json<{ code: string }>().code).toBe('PACKAGE_NOT_DRAFT')

    const versioned = await api('POST', `/api/v1/packages/${packageId}/versions`)
    expect(versioned.statusCode).toBe(201)
    expect(versioned.json<{ versionNumber: number; status: string }>()).toMatchObject({
      versionNumber: 2,
      status: 'draft',
    })

    // The v2 draft carries v1's items, ready to edit.
    const v2 = versioned.json<{ id: string }>().id
    const snapshot = await api('GET', `/api/v1/packages/${v2}`)
    expect(snapshot.json<{ items: unknown[] }>().items).toHaveLength(3)
  })

  it('a draft package cannot be applied — it is still being written', async () => {
    const packageId = await createPackage('unpublished')
    const res = await api('POST', `/api/v1/units/${unitId}/apply-package`, {
      packageId,
      pricingDate: '2026-08-01',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('PACKAGE_NOT_PUBLISHED')
  })
})

describe('applying a package to a unit', () => {
  it('turns rooms into a priced BOQ with a formula on every rule line', async () => {
    const packageId = await createPackage('standard_pkg')
    await publish(packageId)

    const applied = await api('POST', `/api/v1/units/${unitId}/apply-package`, {
      packageId,
      pricingDate: '2026-08-01',
      taxPercentage: '15',
    })
    expect(applied.statusCode, applied.body).toBe(201)
    const result = applied.json<{
      boqId: string
      packageId: string
      packageVersion: number
      sectionCount: number
      lineCount: number
      subtotal: string
      skipped: unknown[]
    }>()

    // Walls in both rooms + bedroom floor + bathroom sanitary = 4 lines.
    expect(result.lineCount).toBe(4)
    expect(result.skipped).toHaveLength(0)
    // Three trades → three sections (walls, flooring, plumbing).
    expect(result.sectionCount).toBe(3)
    expect(result.packageId).toBe(packageId)
    expect(result.packageVersion).toBe(1)

    const snapshot = await api('GET', `/api/v1/boqs/${result.boqId}`)
    const body = snapshot.json<{
      generatedBy: string
      lines: {
        roomId: string
        workItemCode: string
        quantity: string
        lineTotal: string
        source: string
        formulaEvaluated: string | null
        descriptionEn: string
      }[]
    }>()
    expect(body.generatedBy).toBe('rule_engine')

    // The bedroom's wall paint: 18 × 3 − 0 = 54 m², at 9.50 + 8.00.
    const bedroomWalls = body.lines.find(
      (line) => line.roomId === bedroomId && line.workItemCode === 'wk_paint_walls',
    )!
    expect(bedroomWalls.quantity).toBe('54.0000')
    expect(bedroomWalls.source).toBe('rule')
    expect(bedroomWalls.formulaEvaluated).toBe(
      'perimeter_m(18) * height_m(3) - openings_m2(0) = 54.0000',
    )
    expect(bedroomWalls.descriptionEn).toContain('Bedroom 1')

    // The fixed sanitary line: three points, no formula, source 'package'.
    const sanitary = body.lines.find((line) => line.workItemCode === 'wk_plumbing_point')!
    expect(sanitary).toMatchObject({
      roomId: bathroomId,
      quantity: '3.0000',
      source: 'package',
      formulaEvaluated: null,
    })
    // 3 × (95 + 120) = 645.00
    expect(sanitary.lineTotal).toBe('645.00')
  })

  it('reports what it could not price rather than shipping a short BOQ', async () => {
    const packageId = await createPackage('gappy', [
      { element: 'wall', workItemCode: 'wk_paint_walls', ruleCode: 'est_paint_wall_area' },
      // Neither of these exists in the seeded card / catalogue.
      { element: 'ceiling', workItemCode: 'wk_not_on_the_card', fixedQuantity: '1' },
      { element: 'door', workItemCode: 'wk_gypsum_ceiling', ruleCode: 'est_no_such_rule' },
    ])
    await publish(packageId)

    const applied = await api('POST', `/api/v1/units/${unitId}/apply-package`, {
      packageId,
      pricingDate: '2026-08-01',
    })
    expect(applied.statusCode).toBe(201)
    const result = applied.json<{
      lineCount: number
      skipped: { element: string; workItemCode: string; reason: string }[]
    }>()

    expect(result.lineCount).toBe(2) // the wall item, in both rooms
    expect(result.skipped).toHaveLength(4) // two failing items × two rooms
    expect(result.skipped.map((entry) => entry.reason)).toContain(
      'The rate card does not price this work item',
    )
    expect(result.skipped.some((entry) => entry.reason.includes('est_no_such_rule'))).toBe(true)
  })

  it('leaves optional items out unless asked for', async () => {
    const packageId = await createPackage('optional_pkg', [
      { element: 'wall', workItemCode: 'wk_paint_walls', ruleCode: 'est_paint_wall_area' },
      {
        element: 'ceiling',
        workItemCode: 'wk_gypsum_ceiling',
        ruleCode: 'est_tile_area',
        isOptional: true,
      },
    ])
    await publish(packageId)

    const without = await api('POST', `/api/v1/units/${unitId}/apply-package`, {
      packageId,
      pricingDate: '2026-08-01',
    })
    expect(without.json<{ lineCount: number }>().lineCount).toBe(2)

    const with_ = await api('POST', `/api/v1/units/${unitId}/apply-package`, {
      packageId,
      pricingDate: '2026-08-01',
      includeOptional: true,
    })
    expect(with_.json<{ lineCount: number }>().lineCount).toBe(4)
  })
})

describe('the comparison view', () => {
  it('prices tiers against this unit and agrees with what applying produces', async () => {
    const cheap = await createPackage('cheap', [
      { element: 'wall', workItemCode: 'wk_paint_walls', ruleCode: 'est_paint_wall_area' },
    ])
    await publish(cheap)
    const rich = await createPackage('rich', STANDARD_ITEMS, { tier: 'luxury' })
    await publish(rich)

    const compared = await api('POST', `/api/v1/units/${unitId}/package-comparison`, {
      packageIds: [cheap, rich],
      pricingDate: '2026-08-01',
      taxPercentage: '15',
    })
    expect(compared.statusCode, compared.body).toBe(200)
    const body = compared.json<{
      grossArea: string
      data: {
        packageId: string
        lineCount: number
        grandTotal: string
        pricePerSqm: string
      }[]
    }>()

    expect(body.grossArea).toBe('100.0000')
    expect(body.data).toHaveLength(2)
    const [cheapRow, richRow] = body.data
    expect(cheapRow!.lineCount).toBe(2)
    expect(richRow!.lineCount).toBe(4)
    // The richer tier costs more, and per-m² is the total over gross area.
    expect(Number(richRow!.grandTotal)).toBeGreaterThan(Number(cheapRow!.grandTotal))
    expect(richRow!.pricePerSqm).toBe((Number(richRow!.grandTotal) / 100).toFixed(2))

    // The estimate and the real generation are one code path — prove it.
    const applied = await api('POST', `/api/v1/units/${unitId}/apply-package`, {
      packageId: rich,
      pricingDate: '2026-08-01',
      taxPercentage: '15',
    })
    expect(applied.json<{ grandTotal: string }>().grandTotal).toBe(richRow!.grandTotal)
  })

  it('404s when no rate card covers the pricing date', async () => {
    const packageId = await createPackage('dated')
    await publish(packageId)
    const res = await api('POST', `/api/v1/units/${unitId}/package-comparison`, {
      packageIds: [packageId],
      pricingDate: '2025-01-01',
    })
    expect(res.statusCode).toBe(404)
    expect(res.json<{ code: string }>().code).toBe('RATE_CARD_NONE_EFFECTIVE')
  })
})
