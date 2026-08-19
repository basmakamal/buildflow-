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
 * Rule administration over HTTP.
 *
 * The point of this surface is that a business user retunes the engine without
 * a deploy, so the tests care most about the guard rails: that a rule which
 * could never fire is refused at the boundary rather than saved and silently
 * ignored, and that editing is gated behind a permission most roles lack.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let engineerToken: string
let unitId: string
let bathroomId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const api = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
  token?: string,
) => {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${token ?? ownerToken}` },
  }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
}

interface EffectiveRule {
  code: string
  severity: string
  messageEn: string
  messageAr: string
  priority: number
  source: 'system' | 'tenant_override' | 'tenant_custom'
  disabled: boolean
}

const SYSTEM_RULE = {
  code: 'ADMIN_WET_NO_RCD',
  messageEn: 'Wet-area circuits without RCD protection are a shock hazard.',
  messageAr: 'دوائر المناطق الرطبة بدون قاطع تسرب تشكل خطر صعق.',
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
    await raw.kbRule.deleteMany({ where: { code: { startsWith: 'ADMIN_' } } })

    await raw.kbFact.deleteMany({
      where: { factCode: { in: ['roomType', 'area', 'isWetArea', 'hasRcd', 'socketCount'] } },
    })
    await raw.kbFact.createMany({
      data: [
        {
          id: ids.next(),
          factCode: 'roomType',
          labelEn: 'Room Type',
          labelAr: 'نوع الغرفة',
          dataType: 'enum',
          domain: 'room',
          allowedValues: ['bathroom', 'kitchen', 'master_bedroom'],
        },
        {
          id: ids.next(),
          factCode: 'area',
          labelEn: 'Area',
          labelAr: 'المساحة',
          dataType: 'number',
          domain: 'room',
        },
        {
          id: ids.next(),
          factCode: 'isWetArea',
          labelEn: 'Wet',
          labelAr: 'رطبة',
          dataType: 'boolean',
          domain: 'room',
        },
        {
          id: ids.next(),
          factCode: 'hasRcd',
          labelEn: 'RCD',
          labelAr: 'قاطع',
          dataType: 'boolean',
          domain: 'electrical',
        },
        {
          id: ids.next(),
          factCode: 'socketCount',
          labelEn: 'Sockets',
          labelAr: 'أفياش',
          dataType: 'number',
          domain: 'electrical',
        },
      ],
    })

    await raw.kbRule.create({
      data: {
        id: ids.next(),
        code: SYSTEM_RULE.code,
        ruleType: 'validation',
        domain: 'electrical',
        roomTypeCode: null,
        conditions: {
          all: [
            { fact: 'isWetArea', operator: 'equal', value: true },
            { fact: 'hasRcd', operator: 'equal', value: false },
          ],
        },
        severity: 'critical',
        messageEn: SYSTEM_RULE.messageEn,
        messageAr: SYSTEM_RULE.messageAr,
        priority: 1,
      },
    })

    await raw.company.create({
      data: {
        id: COMPANY,
        nameEn: 'Acme',
        nameAr: 'أكمي',
        slug: `acme-adm-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitId = ids.next()
    bathroomId = ids.next()
    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'ADM-1',
        nameEn: 'A',
        nameAr: 'أ',
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
        grossArea: '90',
        currency: 'SAR',
      },
    })
    await raw.room.create({
      data: {
        id: bathroomId,
        companyId: COMPANY,
        unitId,
        typeCode: 'bathroom',
        nameEn: 'Bath',
        nameAr: 'حمام',
        widthMm: 2000,
        lengthMm: 2500,
        heightMm: 2800,
        floorArea: '5',
        wallArea: '25.2',
        ceilingArea: '5',
        perimeter: '9',
      },
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

  ownerToken = await makeUser(`owner-adm-${stamp}@acme.sa`, 'company_owner')
  engineerToken = await makeUser(`eng-adm-${stamp}@acme.sa`, 'site_engineer')
})

const rulesList = async (token?: string) =>
  (await api('GET', '/api/v1/knowledge/rules', undefined, token)).json<{ data: EffectiveRule[] }>()
    .data

const findingCodes = async () =>
  (
    await api('POST', `/api/v1/units/${unitId}/rooms/${bathroomId}/analyze`, {
      facts: { hasRcd: false },
    })
  )
    .json<{ findings: { code: string }[] }>()
    .findings.map((f) => f.code)

describe('rule catalogue', () => {
  it('lists system rules marked as such', async () => {
    const rule = (await rulesList()).find((r) => r.code === SYSTEM_RULE.code)
    expect(rule).toBeDefined()
    expect(rule?.source).toBe('system')
    expect(rule?.disabled).toBe(false)
  })

  it('serves the vocabulary the condition editor is built from', async () => {
    const body = (await api('GET', '/api/v1/knowledge/vocabulary')).json<{
      facts: { factCode: string; dataType: string; allowedValues: string[] | null }[]
      roomTypeCodes: string[]
    }>()

    const roomType = body.facts.find((f) => f.factCode === 'roomType')
    expect(roomType?.dataType).toBe('enum')
    expect(roomType?.allowedValues).toContain('bathroom')
    expect(body.roomTypeCodes).toContain('bathroom')
  })

  it('refuses a role without knowledge.view', async () => {
    expect((await api('GET', '/api/v1/knowledge/rules', undefined, engineerToken)).statusCode).toBe(
      403,
    )
  })
})

describe('overriding a system rule', () => {
  it('disables it, and the engine stops reporting it', async () => {
    expect(await findingCodes()).toContain(SYSTEM_RULE.code)

    const res = await api('PUT', `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`, {
      isDisabled: true,
    })
    expect(res.statusCode).toBe(200)

    expect(await findingCodes()).not.toContain(SYSTEM_RULE.code)
  })

  it('keeps a disabled rule visible so it can be re-enabled', async () => {
    await api('PUT', `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`, { isDisabled: true })
    const rule = (await rulesList()).find((r) => r.code === SYSTEM_RULE.code)

    expect(rule?.disabled).toBe(true)
    expect(rule?.source).toBe('tenant_override')
  })

  it('changes severity and wording, inheriting the rest', async () => {
    await api('PUT', `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`, {
      severity: 'warning',
      messageEn: 'Tenant wording',
    })

    const rule = (await rulesList()).find((r) => r.code === SYSTEM_RULE.code)
    expect(rule?.severity).toBe('warning')
    expect(rule?.messageEn).toBe('Tenant wording')
    // Untouched fields still come from the shipped rule.
    expect(rule?.messageAr).toBe(SYSTEM_RULE.messageAr)
    expect(rule?.priority).toBe(1)
  })

  it('reverts to the shipped rule when the override is deleted', async () => {
    await api('PUT', `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`, { isDisabled: true })
    expect(await findingCodes()).not.toContain(SYSTEM_RULE.code)

    expect((await api('DELETE', `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`)).statusCode).toBe(
      200,
    )

    expect(await findingCodes()).toContain(SYSTEM_RULE.code)
    expect((await rulesList()).find((r) => r.code === SYSTEM_RULE.code)?.source).toBe('system')
  })

  it('404s a revert with no override to remove', async () => {
    const res = await api('DELETE', `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`)
    expect(res.statusCode).toBe(404)
    expect(res.json<{ code: string }>().code).toBe('NOT_FOUND')
  })

  it('refuses a role without knowledge.manage', async () => {
    const res = await api(
      'PUT',
      `/api/v1/knowledge/rules/${SYSTEM_RULE.code}`,
      { isDisabled: true },
      engineerToken,
    )
    expect(res.statusCode).toBe(403)
    expect(await findingCodes()).toContain(SYSTEM_RULE.code)
  })
})

describe('authoring guard rails', () => {
  const badRule = (body: Record<string, unknown>) =>
    api('PUT', '/api/v1/knowledge/rules/ADMIN_CUSTOM', {
      ruleType: 'validation',
      domain: 'electrical',
      severity: 'warning',
      messageEn: 'en',
      messageAr: 'ar',
      ...body,
    })

  it('rejects a condition on a fact that does not exist', async () => {
    const res = await badRule({
      conditions: { all: [{ fact: 'sockeCount', operator: 'lessThan', value: 4 }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RULE_FACT_UNKNOWN')
  })

  it('rejects an enum value the fact can never hold', async () => {
    const res = await badRule({
      conditions: { all: [{ fact: 'roomType', operator: 'equal', value: 'bathrom' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RULE_ENUM_VALUE_INVALID')
  })

  /** The rule would save happily and then never fire — refuse it at the door. */
  it('rejects a room filter that contradicts the conditions', async () => {
    const res = await badRule({
      roomTypeCode: 'kitchen',
      conditions: { all: [{ fact: 'roomType', operator: 'equal', value: 'bathroom' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RULE_FILTER_CONTRADICTS_CONDITION')
  })

  it('rejects an incomplete new rule', async () => {
    const res = await api('PUT', '/api/v1/knowledge/rules/ADMIN_PARTIAL', { severity: 'warning' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RULE_INCOMPLETE')
  })

  it('rejects disabling a rule that does not exist', async () => {
    const res = await api('PUT', '/api/v1/knowledge/rules/ADMIN_GHOST', { isDisabled: true })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('RULE_NOT_FOUND')
  })
})

describe('authoring a new tenant rule', () => {
  it('saves it and the engine evaluates it immediately', async () => {
    const res = await api('PUT', '/api/v1/knowledge/rules/ADMIN_SMALL_WET', {
      ruleType: 'validation',
      domain: 'plumbing',
      severity: 'warning',
      messageEn: 'This wet room is small for our standard.',
      messageAr: 'هذه الغرفة الرطبة صغيرة وفق معيارنا.',
      conditions: {
        all: [
          { fact: 'isWetArea', operator: 'equal', value: true },
          { fact: 'area', operator: 'lessThan', value: 6 },
        ],
      },
      priority: 20,
    })
    expect(res.statusCode).toBe(200)

    expect(await findingCodes()).toContain('ADMIN_SMALL_WET')
    expect((await rulesList()).find((r) => r.code === 'ADMIN_SMALL_WET')?.source).toBe(
      'tenant_custom',
    )
  })
})
