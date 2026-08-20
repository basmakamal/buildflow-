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
import { seedMaterialCategories } from '@buildflow/catalogue'
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * Material catalogue over HTTP.
 *
 * The assertions concentrate on unit conversion, because that is where a wrong
 * answer is plausible rather than obviously broken: 10 boxes reported as 10 m²
 * looks like a number, and only shows up as a short delivery on site.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const RIVAL = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let flooringPorcelainId: string
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

interface CategoryRow {
  id: string
  code: string
  parentId: string | null
  defaultWasteFactor: string
}

interface MaterialRow {
  id: string
  sku: string
  baseUom: string
  wasteFactor: string | null
  effectiveWasteFactor: string
  categoryCode: string
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
    // Full teardown in foreign-key order, including tables this suite never
    // writes. Test files do not clean up after themselves, so whichever suite
    // ran last leaves rows pointing at companies — and this file happens to
    // sort first, so it inherits them. Deleting only what you created works in
    // isolation and fails the moment the suite runs as a whole.
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
          slug: `acme-cat-${String(Date.now())}`,
          countryCode: 'SA',
          defaultCurrency: 'SAR',
        },
        {
          id: RIVAL,
          nameEn: 'Rival',
          nameAr: 'منافس',
          slug: `rival-cat-${String(Date.now())}`,
          countryCode: 'AE',
          defaultCurrency: 'AED',
        },
      ],
    })
  })

  // Categories are global vocabulary; seeding is idempotent by code.
  await runWithoutTenantScope(sys, () => seedMaterialCategories(db, () => ids.next()))

  const porcelain = await runWithoutTenantScope(sys, () =>
    raw.materialCategory.findFirst({ where: { code: 'flooring_porcelain' } }),
  )
  flooringPorcelainId = porcelain!.id

  // A rival-tenant material, to prove cross-tenant reads 404.
  rivalMaterialId = ids.next()
  await runWithoutTenantScope(sys, () =>
    raw.material.create({
      data: {
        id: rivalMaterialId,
        companyId: RIVAL,
        categoryId: flooringPorcelainId,
        sku: 'RIVAL-1',
        nameEn: 'Rival Tile',
        nameAr: 'بلاط منافس',
        baseUom: 'm2',
      },
    }),
  )

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const email = `owner-cat-${String(Date.now())}@acme.sa`
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

const createPorcelain = (over: Record<string, unknown> = {}) =>
  api('POST', '/api/v1/materials', {
    categoryId: flooringPorcelainId,
    sku: 'POR-60',
    nameEn: 'Porcelain 60x60',
    nameAr: 'بورسلان ٦٠×٦٠',
    baseUom: 'm2',
    defaultCost: '55.0000',
    currency: 'SAR',
    conversions: [{ fromUom: 'box', toUom: 'm2', factor: '1.44' }],
    ...over,
  })

describe('category vocabulary', () => {
  it('seeds a nested tree with trade-specific waste factors', async () => {
    const res = await api('GET', '/api/v1/material-categories')
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200)
    const rows = res.json<{ data: CategoryRow[] }>().data

    const flooring = rows.find((r) => r.code === 'flooring')
    const porcelain = rows.find((r) => r.code === 'flooring_porcelain')
    expect(flooring?.parentId).toBeNull()
    expect(porcelain?.parentId).toBe(flooring?.id)

    // Not one global constant: large-format porcelain wastes more than paint,
    // and these match the knowledge base's estimation standards.
    expect(porcelain?.defaultWasteFactor).toBe('12.00')
    expect(rows.find((r) => r.code === 'paint_emulsion')?.defaultWasteFactor).toBe('10.00')
    // Fixtures are counted, not cut.
    expect(rows.find((r) => r.code === 'lighting_decorative')?.defaultWasteFactor).toBe('0.00')
  })

  it('is idempotent — re-seeding adds nothing', async () => {
    const before = (await api('GET', '/api/v1/material-categories')).json<{ data: CategoryRow[] }>()
      .data.length
    await runWithoutTenantScope(sys, () => seedMaterialCategories(db, () => ids.next()))
    const after = (await api('GET', '/api/v1/material-categories')).json<{ data: CategoryRow[] }>()
      .data.length
    expect(after).toBe(before)
  })
})

describe('creating a material', () => {
  it('creates and lists it with a resolved waste factor', async () => {
    expect((await createPorcelain()).statusCode).toBe(201)

    const rows = (await api('GET', '/api/v1/materials')).json<{ data: MaterialRow[] }>().data
    const row = rows.find((r) => r.sku === 'POR-60')
    expect(row?.baseUom).toBe('m2')
    // Inherited from the category, resolved server-side so two screens cannot
    // disagree about the fallback.
    expect(row?.wasteFactor).toBeNull()
    expect(row?.effectiveWasteFactor).toBe('12.00')
  })

  it('rejects a duplicate SKU with 409', async () => {
    await createPorcelain()
    const dup = await createPorcelain({ nameEn: 'Another tile' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json<{ code: string }>().code).toBe('MATERIAL_SKU_TAKEN')
  })

  it('rejects a cost with no currency', async () => {
    const res = await createPorcelain({ defaultCost: '55.0000', currency: null })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('MATERIAL_COST_CURRENCY_MISMATCH')
  })

  it('rejects a conversion that does not target the base unit', async () => {
    const res = await createPorcelain({
      conversions: [{ fromUom: 'box', toUom: 'pcs', factor: '4' }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('MATERIAL_CONVERSION_NOT_TO_BASE')
  })
})

describe('unit conversion', () => {
  const convert = async (materialId: string, body: Record<string, unknown>) =>
    api('POST', `/api/v1/materials/${materialId}/convert`, body)

  it('applies the material-specific factor', async () => {
    const { id } = (await createPorcelain()).json<{ id: string }>()
    const res = await convert(id, { quantity: '10', uom: 'box' })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ base: { quantity: string; uom: string } }>()
    // 10 × 1.44 = 14.40 m², not 10.
    expect(body.base).toEqual({ quantity: '14.4000', uom: 'm2' })
  })

  it('converts before applying waste', async () => {
    const { id } = (await createPorcelain()).json<{ id: string }>()
    const res = await convert(id, { quantity: '10', uom: 'box', applyWaste: true })

    const body = res.json<{ base: { quantity: string }; wasteFactor: string }>()
    // 14.40 m² + 12% category waste = 16.128 m².
    expect(body.base.quantity).toBe('16.1280')
    expect(body.wasteFactor).toBe('12.00')
  })

  /** The failure the design exists to prevent: never assume a factor of 1. */
  it('errors on a unit pairing the material does not define', async () => {
    const { id } = (await createPorcelain()).json<{ id: string }>()
    const res = await convert(id, { quantity: '10', uom: 'pcs' })

    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('MATERIAL_CONVERSION_MISSING')
  })

  it('404s a material belonging to another tenant', async () => {
    const res = await convert(rivalMaterialId, { quantity: '1', uom: 'm2' })
    expect(res.statusCode).toBe(404)
  })
})

describe('tenant isolation', () => {
  it('never lists another tenant materials', async () => {
    await createPorcelain()
    const rows = (await api('GET', '/api/v1/materials')).json<{ data: MaterialRow[] }>().data

    expect(rows.map((r) => r.sku)).toContain('POR-60')
    expect(rows.map((r) => r.sku)).not.toContain('RIVAL-1')
  })

  it('lets both tenants use the same SKU', async () => {
    // Two contractors legitimately call different tiles "POR-60"; the unique
    // key is per company, not global.
    await runWithoutTenantScope(sys, () =>
      raw.material.create({
        data: {
          id: ids.next(),
          companyId: RIVAL,
          categoryId: flooringPorcelainId,
          sku: 'POR-60',
          nameEn: 'Rival Porcelain',
          nameAr: 'بورسلان منافس',
          baseUom: 'm2',
        },
      }),
    )
    expect((await createPorcelain()).statusCode).toBe(201)
  })
})
