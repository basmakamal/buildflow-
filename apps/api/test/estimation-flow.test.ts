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
 * The quantity rule engine over HTTP: the shipped catalogue lists and
 * evaluates, overrides validate at write time and win at read time, one
 * tenant's override is invisible to another (the raw-SQL path is the tenant
 * boundary here, so THAT is what this proves), and deleting the override
 * puts the shipped rule back in force.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY_A = ids.next<'CompanyId'>()
const COMPANY_B = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let tokenA: string
let tokenB: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const api = (
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) => {
  const options: InjectOptions = { method, url, headers: { authorization: `Bearer ${token}` } }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
}

interface RuleView {
  code: string
  formula: string
  wastePct: string
  isActive: boolean
  isOverride: boolean
  inputs: { var: string }[]
}

const listRules = async (token: string): Promise<RuleView[]> => {
  const res = await api(token, 'GET', '/api/v1/estimation/rules')
  expect(res.statusCode).toBe(200)
  return res.json<{ data: RuleView[] }>().data
}

const paintRule = async (token: string): Promise<RuleView> => {
  const rules = await listRules(token)
  const rule = rules.find((candidate) => candidate.code === 'est_paint_quantity')
  expect(rule).toBeDefined()
  return rule!
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
    // Tenant replacement rows only — the shipped catalogue must survive.
    await raw.$executeRaw`DELETE FROM kb_estimation_standards WHERE company_id IS NOT NULL`
    await raw.outboxEvent.deleteMany({})
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.kbRuleOverride.deleteMany({})
    await raw.user.deleteMany({})
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
    await raw.materialUomConversion.deleteMany({})
    await raw.material.deleteMany({})
    await raw.room.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.company.deleteMany({})

    await raw.company.createMany({
      data: [
        {
          id: COMPANY_A,
          nameEn: 'Acme',
          nameAr: 'أكمي',
          slug: `acme-est-a-${String(Date.now())}`,
          countryCode: 'SA',
          defaultCurrency: 'SAR',
        },
        {
          id: COMPANY_B,
          nameEn: 'Bravo',
          nameAr: 'برافو',
          slug: `acme-est-b-${String(Date.now())}`,
          countryCode: 'SA',
          defaultCurrency: 'SAR',
        },
      ],
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())

  const login = async (companyId: string, email: string): Promise<string> => {
    const roleIds = await runWithoutTenantScope(sys, () =>
      seedCompanyRoles(db, companyId as never, () => ids.next()),
    )
    const userId = ids.next()
    await runWithoutTenantScope(sys, async () => {
      await raw.user.create({
        data: {
          id: userId,
          companyId,
          email,
          passwordHash: hash,
          firstNameEn: 'O',
          lastNameEn: 'U',
          status: 'active',
        },
      })
      await raw.userRole.create({
        data: { userId, roleId: roleIds['company_owner']!, companyId },
      })
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { companyId, email, password: PASSWORD },
    })
    return res.json<{ accessToken: string }>().accessToken
  }

  tokenA = await login(COMPANY_A, `owner-est-a-${String(Date.now())}@acme.sa`)
  tokenB = await login(COMPANY_B, `owner-est-b-${String(Date.now())}@bravo.sa`)
})

describe('the shipped catalogue', () => {
  it('lists the knowledge-base rules, none of them overridden', async () => {
    const rules = await listRules(tokenA)
    expect(rules.length).toBeGreaterThanOrEqual(30)
    expect(rules.every((rule) => !rule.isOverride)).toBe(true)

    const paint = rules.find((rule) => rule.code === 'est_paint_quantity')
    expect(paint).toMatchObject({ wastePct: '10.00', isActive: true })
  })

  it('every shipped formula parses and evaluates — the catalogue ships runnable', async () => {
    const rules = await listRules(tokenA)
    for (const rule of rules) {
      const inputs = Object.fromEntries(rule.inputs.map((input) => [input.var, '1']))
      const res = await api(tokenA, 'POST', `/api/v1/estimation/rules/${rule.code}/evaluate`, {
        inputs,
      })
      expect(res.statusCode, `${rule.code}: ${res.body}`).toBe(200)
    }
  })

  it('returns the defensibility string with every input substituted', async () => {
    const res = await api(tokenA, 'POST', '/api/v1/estimation/rules/est_paint_quantity/evaluate', {
      inputs: { area_m2: '43.7', coats: '2', coverage_m2_per_l: '10' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      quantity: '8.7400',
      wastePct: '10.00',
      quantityWithWaste: '9.6140',
      formulaEvaluated: 'area_m2(43.7) * coats(2) / coverage_m2_per_l(10) = 8.7400',
    })
  })
})

describe('overrides', () => {
  it('waste is the most-adjusted number per company — and only per company', async () => {
    const put = await api(tokenA, 'PUT', '/api/v1/estimation/rules/est_paint_quantity/override', {
      wastePct: '15.00',
      notes: 'Spray application on all our sites',
    })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ wastePct: '15.00', isOverride: true })

    // Company A evaluates with 15 % …
    const evaluated = await api(
      tokenA,
      'POST',
      '/api/v1/estimation/rules/est_paint_quantity/evaluate',
      { inputs: { area_m2: '43.7', coats: '2', coverage_m2_per_l: '10' } },
    )
    expect(evaluated.json()).toMatchObject({ quantityWithWaste: '10.0510' })

    // … and company B still sees the shipped 10 %.
    expect(await paintRule(tokenB)).toMatchObject({ wastePct: '10.00', isOverride: false })
  })

  it('validates a replacement formula at write time, against the declared inputs', async () => {
    const undeclared = await api(
      tokenA,
      'PUT',
      '/api/v1/estimation/rules/est_paint_quantity/override',
      { formula: 'area_m2 * secret_factor' },
    )
    expect(undeclared.statusCode).toBe(400)
    expect(undeclared.json<{ code: string }>().code).toBe('FORMULA_UNDECLARED_VARIABLE')

    const malformed = await api(
      tokenA,
      'PUT',
      '/api/v1/estimation/rules/est_paint_quantity/override',
      { formula: 'area_m2 *' },
    )
    expect(malformed.statusCode).toBe(400)
    expect(malformed.json<{ code: string }>().code).toBe('FORMULA_INVALID')

    const accepted = await api(
      tokenA,
      'PUT',
      '/api/v1/estimation/rules/est_paint_quantity/override',
      { formula: 'area_m2 * coats / 12' },
    )
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toMatchObject({ formula: 'area_m2 * coats / 12', isOverride: true })
  })

  it('a disabled rule refuses to evaluate', async () => {
    await api(tokenA, 'PUT', '/api/v1/estimation/rules/est_paint_quantity/override', {
      isActive: false,
    })
    const res = await api(tokenA, 'POST', '/api/v1/estimation/rules/est_paint_quantity/evaluate', {
      inputs: { area_m2: '1', coats: '1', coverage_m2_per_l: '1' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RULE_DISABLED')
  })

  it('deleting the override puts the shipped rule back in force', async () => {
    await api(tokenA, 'PUT', '/api/v1/estimation/rules/est_paint_quantity/override', {
      wastePct: '25.00',
    })
    const removed = await api(
      tokenA,
      'DELETE',
      '/api/v1/estimation/rules/est_paint_quantity/override',
    )
    expect(removed.statusCode).toBe(200)
    expect(removed.json<{ restored: RuleView }>().restored).toMatchObject({
      wastePct: '10.00',
      isOverride: false,
    })

    const again = await api(
      tokenA,
      'DELETE',
      '/api/v1/estimation/rules/est_paint_quantity/override',
    )
    expect(again.statusCode).toBe(404)
  })

  it('404s an unknown rule code', async () => {
    const res = await api(tokenA, 'PUT', '/api/v1/estimation/rules/no_such_rule/override', {
      wastePct: '5.00',
    })
    expect(res.statusCode).toBe(404)
  })
})
