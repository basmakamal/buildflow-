import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
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
 * Route guards, end to end.
 *
 * The point of this suite is the DENIALS. A test that only proves an owner can
 * reach an endpoint proves nothing about authorization — it would pass just as
 * happily with no guard at all. Every case here asserts that someone who should
 * not get through, does not.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let container: ReturnType<typeof createContainer>
let roleIds: Record<string, string>

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

beforeAll(async () => {
  await raw.$connect()
  container = createContainer({ db, jwtSecret: randomBytes(32).toString('base64url') })
  app = await buildServer({ container, db })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await raw.$disconnect()
})

beforeEach(async () => {
  await runWithoutTenantScope(sys, async () => {
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.user.deleteMany({})
    await raw.company.deleteMany({})

    await raw.company.create({
      data: {
        id: COMPANY,
        nameEn: 'Acme',
        nameAr: 'أكمي',
        slug: `acme-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  roleIds = await runWithoutTenantScope(sys, () => seedCompanyRoles(db, COMPANY, () => ids.next()))
})

/** Creates a user with a role and optional project assignments, then logs in. */
async function actor(
  role: keyof typeof roleIds,
  assignments: { scopeType: 'company' | 'project'; scopeId: string }[] = [],
): Promise<string> {
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)
  const email = `${role}-${String(Date.now())}-${Math.floor(performance.now())}@acme.sa`
  const userId = ids.next()

  await runWithoutTenantScope(sys, async () => {
    await raw.user.create({
      data: {
        id: userId,
        companyId: COMPANY,
        email,
        passwordHash: hash,
        firstNameEn: 'Test',
        lastNameEn: 'User',
        status: 'active',
      },
    })
    await raw.userRole.create({
      data: { userId, roleId: roleIds[role]!, companyId: COMPANY },
    })
    for (const a of assignments) {
      await raw.userAssignment.create({
        data: {
          id: ids.next(),
          companyId: COMPANY,
          userId,
          scopeType: a.scopeType,
          scopeId: a.scopeId,
        },
      })
    }
  })

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { companyId: COMPANY, email, password: PASSWORD },
  })
  return res.json<{ accessToken: string }>().accessToken
}

const get = (url: string, token?: string) =>
  app.inject({
    method: 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

describe('authentication guard', () => {
  it('rejects a request with no token', async () => {
    const res = await get('/api/v1/auth/me')
    expect(res.statusCode).toBe(401)
    expect(res.json<{ code: string }>().code).toBe('UNAUTHENTICATED')
  })

  it('rejects a malformed token', async () => {
    const res = await get('/api/v1/auth/me', 'not-a-real-token')
    expect(res.statusCode).toBe(401)
    expect(res.json<{ code: string }>().code).toBe('INVALID_TOKEN')
  })

  it('accepts a valid token and resolves the principal', async () => {
    const token = await actor('site_engineer')
    const res = await get('/api/v1/auth/me', token)
    expect(res.statusCode).toBe(200)
    expect(res.json<{ permissions: string[] }>().permissions).toContain('stage.update_progress')
  })
})

describe('permission enforcement', () => {
  it('allows a project manager to list projects', async () => {
    const res = await get('/api/v1/projects', await actor('project_manager'))
    expect(res.statusCode).toBe(200)
  })

  it('denies a client the ability to create a project', async () => {
    // Holds project.view, does NOT hold project.create. The body is valid so
    // this asserts the guard, not schema validation.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${await actor('client')}` },
      payload: { code: 'X-1', nameEn: 'Xx', nameAr: 'سس' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json<{ code: string }>().code).toBe('FORBIDDEN')
  })

  it('denies a site engineer the ability to create a project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${await actor('site_engineer')}` },
      payload: { code: 'X-2', nameEn: 'Xx', nameAr: 'سس' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('allows an owner everything', async () => {
    const token = await actor('company_owner')
    expect((await get('/api/v1/projects', token)).statusCode).toBe(200)
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'OWN-1', nameEn: 'Owner Tower', nameAr: 'برج المالك' },
    })
    expect(created.statusCode).toBe(201)
  })
})

describe('field-level cost visibility', () => {
  it('hides cost from a site engineer', async () => {
    // The most requested control in this market: crews see quantities, not
    // prices. docs/11 §3.3
    const res = await get('/api/v1/auth/me', await actor('site_engineer'))
    const body = res.json<{ capabilities: { canSeeCost: boolean }; permissions: string[] }>()
    expect(body.capabilities.canSeeCost).toBe(false)
    expect(body.permissions).not.toContain('cost.view')
    // …but quantities remain visible.
    expect(body.permissions).toContain('material.view')
  })

  it('shows cost to an accountant', async () => {
    const res = await get('/api/v1/auth/me', await actor('accountant'))
    const body = res.json<{ capabilities: { canSeeCost: boolean; canSeeMargin: boolean } }>()
    expect(body.capabilities.canSeeCost).toBe(true)
    expect(body.capabilities.canSeeMargin).toBe(true)
  })

  it('shows cost but not margin to procurement', async () => {
    const res = await get('/api/v1/auth/me', await actor('procurement_officer'))
    const body = res.json<{ capabilities: { canSeeCost: boolean; canSeeMargin: boolean } }>()
    expect(body.capabilities.canSeeCost).toBe(true)
    expect(body.capabilities.canSeeMargin).toBe(false)
  })
})

describe('ABAC scoping — actual data visibility', () => {
  /** Seeds two projects and returns their ids. */
  async function seedProjects(): Promise<[string, string]> {
    const a = ids.next()
    const b = ids.next()
    await runWithoutTenantScope(sys, async () => {
      await raw.project.createMany({
        data: [
          {
            id: a,
            companyId: COMPANY,
            code: 'PRJ-A',
            nameEn: 'Tower A',
            nameAr: 'برج أ',
            currency: 'SAR',
          },
          {
            id: b,
            companyId: COMPANY,
            code: 'PRJ-B',
            nameEn: 'Tower B',
            nameAr: 'برج ب',
            currency: 'SAR',
          },
        ],
      })
    })
    return [a, b]
  }

  it('shows every project to a principal with view_all', async () => {
    const [a, b] = await seedProjects()
    const res = await get('/api/v1/projects', await actor('project_manager'))
    const returned = res.json<{ data: { id: string }[] }>().data.map((p) => p.id)
    expect(returned).toContain(a)
    expect(returned).toContain(b)
  })

  it('shows a scoped engineer only their assigned project', async () => {
    const [a, b] = await seedProjects()
    const token = await actor('site_engineer', [{ scopeType: 'project', scopeId: a }])
    const returned = (await get('/api/v1/projects', token))
      .json<{ data: { id: string }[] }>()
      .data.map((p) => p.id)
    expect(returned).toContain(a)
    expect(returned).not.toContain(b)
  })

  it('returns an empty list — not everything — when assigned to nothing', async () => {
    // The failure that would matter: treating "no assignments" as "no filter".
    await seedProjects()
    const res = await get('/api/v1/projects', await actor('site_engineer'))
    expect(res.json<{ data: unknown[] }>().data).toEqual([])
  })
})

describe('permHash', () => {
  it('is a real fingerprint, not the placeholder', async () => {
    const token = await actor('accountant')
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
      string,
      unknown
    >
    expect(payload['permHash']).not.toBe('pending')
    expect(payload['permHash']).not.toBe('unresolved')
    expect(String(payload['permHash'])).toHaveLength(16)
  })

  it('differs between roles with different permissions', async () => {
    const hashOf = (t: string) =>
      (JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString()) as { permHash: string })
        .permHash
    expect(hashOf(await actor('site_engineer'))).not.toBe(hashOf(await actor('accountant')))
  })
})

describe('permission revocation', () => {
  /**
   * The contract is explicit: permissions are cached for 60 seconds, so a
   * revocation lands within that window — NOT instantly. The role-management
   * command invalidates the cache so the change is immediate in practice.
   *
   * An earlier version of this test asserted instant revocation without
   * invalidating, and failed. The test was wrong, not the cache: asserting a
   * guarantee the design never made would have meant either weakening the
   * cache or leaving a permanently red test. docs/11 §2.2
   */
  it('takes effect immediately once the cache is invalidated', async () => {
    const hash = await new Argon2PasswordHasher().hash(PASSWORD)
    const email = `revoke-${String(Date.now())}@acme.sa`
    const userId = ids.next()

    await runWithoutTenantScope(sys, async () => {
      await raw.user.create({
        data: {
          id: userId,
          companyId: COMPANY,
          email,
          passwordHash: hash,
          firstNameEn: 'R',
          lastNameEn: 'U',
          status: 'active',
        },
      })
      await raw.userRole.create({
        data: { userId, roleId: roleIds['project_manager']!, companyId: COMPANY },
      })
    })

    const doLogin = async () =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { companyId: COMPANY, email, password: PASSWORD },
        })
      ).json<{ accessToken: string }>().accessToken

    expect((await get('/api/v1/projects', await doLogin())).statusCode).toBe(200)

    // Strip the role entirely.
    await runWithoutTenantScope(sys, () => raw.userRole.deleteMany({ where: { userId } }))

    // Still permitted: the resolved set is cached for the TTL. This is the
    // documented trade, asserted rather than glossed over.
    expect((await get('/api/v1/projects', await doLogin())).statusCode).toBe(200)

    // What a role-management command does on every change.
    await container.permissions.invalidate(COMPANY, userId as never)

    const after = await get('/api/v1/projects', await doLogin())
    expect(after.statusCode).toBe(403)
  })

  it('resolves an empty permission set for a user with no roles', async () => {
    // Fails closed: no roles must mean no access, never "unrestricted".
    const hash = await new Argon2PasswordHasher().hash(PASSWORD)
    const email = `norole-${String(Date.now())}@acme.sa`
    const userId = ids.next()
    await runWithoutTenantScope(sys, () =>
      raw.user.create({
        data: {
          id: userId,
          companyId: COMPANY,
          email,
          passwordHash: hash,
          firstNameEn: 'N',
          lastNameEn: 'R',
          status: 'active',
        },
      }),
    )

    const token = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { companyId: COMPANY, email, password: PASSWORD },
      })
    ).json<{ accessToken: string }>().accessToken

    expect(
      (await get('/api/v1/auth/me', token)).json<{ permissions: string[] }>().permissions,
    ).toEqual([])
    expect((await get('/api/v1/projects', token)).statusCode).toBe(403)
  })
})
