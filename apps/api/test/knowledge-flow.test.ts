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
 * Room analysis over HTTP, and the tenancy boundary around the rule catalogue.
 *
 * The catalogue (kb_rules) is deliberately global — every tenant evaluates the
 * same product rules — while tenant customisation lives in kb_rule_overrides and
 * is scoped like any other tenant table. That split is the whole reason the
 * engine can read system rules on a request path without bypassing tenant
 * scoping, so it is tested here rather than assumed.
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
let bathroomId: string
let bedroomId: string
let otherRoomId: string

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

interface AnalyzeBody {
  kbRoomCode: string
  findings: { code: string; severity: string; message: { en: string; ar: string } }[]
  coverage: { evaluated: number; skipped: number; unlocks: { fact: string; rules: number }[] }
  ignoredFacts: string[]
}

/** The two system rules this suite asserts on, inserted rather than assumed. */
const SYSTEM_RULES = [
  {
    code: 'TEST_WET_NO_RCD',
    rule_type: 'validation',
    domain: 'electrical',
    conditions: {
      all: [
        { fact: 'isWetArea', operator: 'equal', value: true },
        { fact: 'hasRcd', operator: 'equal', value: false },
      ],
    },
    severity: 'critical',
    message_en: 'Wet-area circuits without RCD protection are a shock hazard.',
    message_ar: 'دوائر المناطق الرطبة بدون قاطع تسرب تشكل خطر صعق.',
    priority: 1,
  },
  {
    code: 'TEST_BIG_BEDROOM',
    rule_type: 'recommendation',
    domain: 'lighting',
    conditions: {
      all: [
        { fact: 'roomType', operator: 'equal', value: 'master_bedroom' },
        { fact: 'area', operator: 'greaterThan', value: 20 },
      ],
    },
    severity: 'suggestion',
    message_en: 'Add a secondary lighting zone.',
    message_ar: 'أضف منطقة إضاءة ثانوية.',
    priority: 10,
  },
]

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
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.room.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.user.deleteMany({})
    await raw.company.deleteMany({})
    await raw.kbRuleOverride.deleteMany({})
    await raw.kbRule.deleteMany({ where: { code: { startsWith: 'TEST_' } } })

    await raw.kbFact.deleteMany({
      where: { factCode: { in: ['roomType', 'area', 'isWetArea', 'hasRcd'] } },
    })
    await raw.kbFact.createMany({
      data: [
        { id: ids.next(), factCode: 'roomType', labelEn: 'Room Type', labelAr: 'نوع الغرفة', dataType: 'enum', domain: 'room' },
        { id: ids.next(), factCode: 'area', labelEn: 'Area', labelAr: 'المساحة', dataType: 'number', domain: 'room' },
        { id: ids.next(), factCode: 'isWetArea', labelEn: 'Wet Area', labelAr: 'منطقة رطبة', dataType: 'boolean', domain: 'room' },
        { id: ids.next(), factCode: 'hasRcd', labelEn: 'Has RCD', labelAr: 'قاطع تسرب', dataType: 'boolean', domain: 'electrical' },
      ],
    })

    await raw.kbRule.createMany({
      data: SYSTEM_RULES.map((rule) => ({
        id: ids.next(),
        code: rule.code,
        ruleType: rule.rule_type as 'validation' | 'recommendation',
        domain: rule.domain as 'electrical' | 'lighting',
        roomTypeCode: null,
        conditions: rule.conditions,
        severity: rule.severity as 'critical' | 'suggestion',
        messageEn: rule.message_en,
        messageAr: rule.message_ar,
        priority: rule.priority,
      })),
    })

    await raw.company.createMany({
      data: [
        { id: COMPANY, nameEn: 'Acme', nameAr: 'أكمي', slug: `acme-kb-${String(Date.now())}`, countryCode: 'SA', defaultCurrency: 'SAR' },
        { id: RIVAL, nameEn: 'Rival', nameAr: 'منافس', slug: `rival-kb-${String(Date.now())}`, countryCode: 'AE', defaultCurrency: 'AED' },
      ],
    })

    const projectId = ids.next()
    unitId = ids.next()
    bathroomId = ids.next()
    bedroomId = ids.next()
    otherRoomId = ids.next()

    await raw.project.create({
      data: { id: projectId, companyId: COMPANY, code: 'KB-1', nameEn: 'KB', nameAr: 'ق', currency: 'SAR' },
    })
    await raw.unit.create({
      data: { id: unitId, companyId: COMPANY, projectId, unitNumber: '1', name: 'Unit', grossArea: '120', currency: 'SAR' },
    })
    await raw.room.createMany({
      data: [
        {
          id: bathroomId, companyId: COMPANY, unitId, typeCode: 'bathroom',
          nameEn: 'Bath', nameAr: 'حمام', widthMm: 2000, lengthMm: 2500, heightMm: 2800,
          floorArea: '5', wallArea: '25.2', ceilingArea: '5', perimeter: '9',
        },
        {
          id: bedroomId, companyId: COMPANY, unitId, typeCode: 'master_bedroom',
          nameEn: 'Master', nameAr: 'رئيسية', widthMm: 4200, lengthMm: 5700, heightMm: 3000,
          floorArea: '23.94', wallArea: '59.4', ceilingArea: '23.94', perimeter: '19.8',
        },
        {
          id: otherRoomId, companyId: COMPANY, unitId, typeCode: 'other',
          nameEn: 'Odd', nameAr: 'أخرى', widthMm: 3000, lengthMm: 3000, heightMm: 3000,
          floorArea: '9', wallArea: '36', ceilingArea: '9', perimeter: '12',
        },
      ],
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () => seedCompanyRoles(db, COMPANY, () => ids.next()))

  const email = `owner-kb-${String(Date.now())}@acme.sa`
  const userId = ids.next()
  await runWithoutTenantScope(sys, async () => {
    await raw.user.create({
      data: { id: userId, companyId: COMPANY, email, passwordHash: hash, firstNameEn: 'Owner', lastNameEn: 'User', status: 'active' },
    })
    await raw.userRole.create({ data: { userId, roleId: roleIds['company_owner']!, companyId: COMPANY } })
  })

  ownerToken = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { companyId: COMPANY, email, password: PASSWORD },
    })
  ).json<{ accessToken: string }>().accessToken
})

describe('room analysis', () => {
  it('derives wet-area facts and fires a system rule', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
      facts: { hasRcd: false },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json<AnalyzeBody>()
    expect(body.kbRoomCode).toBe('bathroom')
    const finding = body.findings.find((f) => f.code === 'TEST_WET_NO_RCD')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('critical')
    // Both languages always travel; the client picks. docs/12
    expect(finding?.message.ar.length).toBeGreaterThan(0)
  })

  it('derives area from stored geometry with no supplied facts', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bedroomId}/analyze`)
    expect(res.statusCode).toBe(200)
    expect(res.json<AnalyzeBody>().findings.map((f) => f.code)).toContain('TEST_BIG_BEDROOM')
  })

  /**
   * The distinction the whole design rests on: no socket data must not be
   * reported as bad socket data.
   */
  it('skips rules whose facts are absent rather than firing them', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`)
    const body = res.json<AnalyzeBody>()

    expect(body.findings.map((f) => f.code)).not.toContain('TEST_WET_NO_RCD')
    expect(body.coverage.skipped).toBeGreaterThan(0)
    expect(body.coverage.unlocks.some((u) => u.fact === 'hasRcd')).toBe(true)
  })

  it('refuses an uncovered room type instead of returning an empty pass', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${otherRoomId}/analyze`)
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('ROOM_TYPE_NOT_COVERED')
  })

  /**
   * Regression guard. Fastify's Ajv runs with coerceTypes + removeAdditional;
   * expressing the facts value schema as an `anyOf` instead of a `type` array
   * makes it strip every supplied fact and return 200 with no findings and no
   * error — a silent, total loss of the payload.
   */
  it('delivers every supplied fact type through schema validation', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
      facts: { hasRcd: false, area: 5, roomLabel: 'text', nothing: null },
    })
    const body = res.json<AnalyzeBody>()

    // hasRcd survived as a boolean false, so the wet-area rule fired.
    expect(body.findings.map((f) => f.code)).toContain('TEST_WET_NO_RCD')
    // The unknown codes were reported, proving they arrived rather than
    // being stripped before the handler ever saw them.
    expect(body.ignoredFacts.sort()).toEqual(['nothing', 'roomLabel'])
  })

  it('reports coverage against the rules a filter allowed, not the whole catalogue', async () => {
    const all = await api('POST', `/api/v1/units/${unitId}/rooms/${bedroomId}/analyze`)
    const narrowed = await api('POST', `/api/v1/units/${unitId}/rooms/${bedroomId}/analyze`, {
      ruleTypes: ['validation'],
    })

    const allCoverage = all.json<AnalyzeBody>().coverage
    const narrowedCoverage = narrowed.json<AnalyzeBody>().coverage
    expect(narrowedCoverage.evaluated + narrowedCoverage.skipped).toBeLessThan(
      allCoverage.evaluated + allCoverage.skipped,
    )
  })

  it('echoes unknown supplied facts rather than silently dropping them', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bedroomId}/analyze`, {
      facts: { notARealFact: 12 },
    })
    expect(res.json<AnalyzeBody>().ignoredFacts).toEqual(['notARealFact'])
  })

  it('ignores a request trying to declare a bathroom dry', async () => {
    // Otherwise a caller could silence every critical wet-area rule.
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
      facts: { isWetArea: false, hasRcd: false },
    })
    expect(res.json<AnalyzeBody>().findings.map((f) => f.code)).toContain('TEST_WET_NO_RCD')
  })

  it('filters by rule type', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bedroomId}/analyze`, {
      ruleTypes: ['validation'],
    })
    expect(res.json<AnalyzeBody>().findings.map((f) => f.code)).not.toContain('TEST_BIG_BEDROOM')
  })

  it('404s a room in another tenant unit', async () => {
    const res = await api('POST', `/api/v1/units/${ids.next()}/rooms/${bathroomId}/analyze`)
    expect(res.statusCode).toBe(404)
  })
})

describe('tenant rule overrides', () => {
  it('lets a tenant disable a system rule', async () => {
    await runWithoutTenantScope(sys, () =>
      raw.kbRuleOverride.create({
        data: { id: ids.next(), companyId: COMPANY, code: 'TEST_WET_NO_RCD', isDisabled: true },
      }),
    )

    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
      facts: { hasRcd: false },
    })
    expect(res.json<AnalyzeBody>().findings.map((f) => f.code)).not.toContain('TEST_WET_NO_RCD')
  })

  it('lets a tenant downgrade a system rule severity and wording', async () => {
    await runWithoutTenantScope(sys, () =>
      raw.kbRuleOverride.create({
        data: {
          id: ids.next(),
          companyId: COMPANY,
          code: 'TEST_WET_NO_RCD',
          severity: 'warning',
          messageEn: 'Tenant wording',
        },
      }),
    )

    const finding = res_find(
      await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
        facts: { hasRcd: false },
      }),
      'TEST_WET_NO_RCD',
    )
    expect(finding?.severity).toBe('warning')
    expect(finding?.message.en).toBe('Tenant wording')
    // Unset fields inherit from the system rule rather than blanking.
    expect(finding?.message.ar).toBe(SYSTEM_RULES[0]!.message_ar)
  })

  /**
   * The property that justifies keeping kb_rules global: one tenant's overrides
   * must be invisible to another. If this fails, the split has been collapsed
   * back into a single nullable-companyId table somewhere.
   */
  it('does not apply another tenant overrides', async () => {
    await runWithoutTenantScope(sys, () =>
      raw.kbRuleOverride.create({
        data: { id: ids.next(), companyId: RIVAL, code: 'TEST_WET_NO_RCD', isDisabled: true },
      }),
    )

    const res = await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
      facts: { hasRcd: false },
    })
    // The rival disabled it; for us it must still fire, at full severity.
    const finding = res_find(res, 'TEST_WET_NO_RCD')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('critical')
  })
})

function res_find(
  res: Awaited<ReturnType<typeof api>>,
  code: string,
): AnalyzeBody['findings'][number] | undefined {
  return res.json<AnalyzeBody>().findings.find((f) => f.code === code)
}
