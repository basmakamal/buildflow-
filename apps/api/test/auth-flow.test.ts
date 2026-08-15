import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator } from '@buildflow/core'
import { withTenantScope, bindTenantContext, runWithoutTenantScope } from '@buildflow/database'
import { Argon2PasswordHasher } from '@buildflow/identity'
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * End-to-end authentication, over real HTTP against a real database.
 *
 * Nothing is mocked. The value of this suite is that it exercises the seams the
 * unit tests cannot: cookie handling, tenant context propagation through the
 * request lifecycle, Prisma persistence, and the interaction between them.
 *
 * The reuse-detection case is the reason it exists. That behaviour spans a pure
 * domain function, two repositories, a cookie, and a transaction — a bug in the
 * wiring between them would leave the unit tests entirely green.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const OTHER_COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'
const EMAIL = 'khaled@acme.sa'

let app: FastifyInstance
let userId: string

const cookieFrom = (res: { headers: Record<string, unknown> }): string => {
  const header: unknown = res.headers['set-cookie']
  const value: unknown = Array.isArray(header) ? header[0] : header
  return String(value).split(';')[0] ?? ''
}

beforeAll(async () => {
  await raw.$connect()
  app = await buildServer({
    container: createContainer({
      db,
      jwtSecret: randomBytes(32).toString('base64url'),
    }),
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
  await runWithoutTenantScope(
    { userId: null, requestId: 'seed', source: 'system', locale: 'en' },
    async () => {
      // Deleted child-first. This database is shared with the packages/database
      // suite, so rows it created may still reference these companies — hence
      // the units/projects/audit sweep, not just the identity tables.
      await raw.refreshToken.deleteMany({})
      await raw.session.deleteMany({})
      await raw.loginAttempt.deleteMany({})
      await raw.auditLog.deleteMany({})
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
            slug: `acme-${String(Date.now())}`,
            countryCode: 'SA',
            defaultCurrency: 'SAR',
          },
          {
            id: OTHER_COMPANY,
            nameEn: 'Globex',
            nameAr: 'جلوبكس',
            slug: `glx-${String(Date.now())}`,
            countryCode: 'AE',
            defaultCurrency: 'AED',
          },
        ],
      })

      userId = ids.next()
      await raw.user.create({
        data: {
          id: userId,
          companyId: COMPANY,
          email: EMAIL,
          passwordHash: hash,
          firstNameEn: 'Khaled',
          lastNameEn: 'Al Otaibi',
          status: 'active',
        },
      })
    },
  )
})

const login = (over: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { companyId: COMPANY, email: EMAIL, password: PASSWORD, ...over },
  })

describe('POST /auth/login', () => {
  it('issues an access token and an httpOnly refresh cookie', async () => {
    const res = await login()
    expect(res.statusCode).toBe(200)

    const body = res.json<{ accessToken: string; expiresIn: number }>()
    expect(body.accessToken.split('.')).toHaveLength(3)
    expect(body.expiresIn).toBe(900)

    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toContain('bf_refresh=')
    // Unreadable from JavaScript, so an XSS cannot exfiltrate a 30-day credential.
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('never returns the refresh token in the body', async () => {
    const res = await login()
    expect(JSON.stringify(res.json())).not.toContain('bf_refresh')
    expect(res.json<Record<string, unknown>>()['refreshToken']).toBeUndefined()
  })

  it('rejects a wrong password', async () => {
    const res = await login({ password: 'wrong-password-entirely' })
    expect(res.statusCode).toBe(401)
    expect(res.json<{ code: string }>().code).toBe('INVALID_CREDENTIALS')
  })

  it('returns an identical response for an unknown account', async () => {
    // Same code, same status. Distinguishing them turns login into a user
    // enumeration oracle. docs/11 §2.1
    const unknown = await login({ email: 'nobody@acme.sa' })
    const wrong = await login({ password: 'wrong-password-entirely' })
    expect(unknown.statusCode).toBe(wrong.statusCode)
    expect(unknown.json<{ code: string }>().code).toBe(wrong.json<{ code: string }>().code)
  })

  it('cannot log in against another tenant with the same email', async () => {
    const res = await login({ companyId: OTHER_COMPANY })
    expect(res.statusCode).toBe(401)
  })

  it('locks the account after five failures', async () => {
    for (let i = 0; i < 5; i++) await login({ password: 'wrong-password-entirely' })
    const res = await login()
    // Correct password now, but the account is locked.
    expect(res.statusCode).toBe(401)
    expect(res.json<{ code: string }>().code).toBe('ACCOUNT_LOCKED')
  })

  it('rejects a malformed body before reaching the handler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { companyId: COMPANY, email: EMAIL },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('VALIDATION_FAILED')
  })

  it('records the attempt for brute-force detection', async () => {
    await login({ password: 'wrong-password-entirely' })
    const attempts = await runWithoutTenantScope(
      { userId: null, requestId: 't', source: 'system', locale: 'en' },
      () => raw.loginAttempt.findMany(),
    )
    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.success).toBe(false)
    expect(attempts[0]!.failureReason).toBe('bad_password')
  })
})

describe('POST /auth/refresh', () => {
  it('rotates the token and returns a new one', async () => {
    const first = await login()
    const cookie1 = cookieFrom(first)

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookie1 },
    })

    expect(refreshed.statusCode).toBe(200)
    const cookie2 = cookieFrom(refreshed)
    // Rotation: a new token every time, never the same one returned.
    expect(cookie2).not.toBe(cookie1)
    expect(refreshed.json<{ accessToken: string }>().accessToken.split('.')).toHaveLength(3)
  })

  it('rejects a request with no cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unknown token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `bf_refresh=${randomBytes(32).toString('base64url')}` },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json<{ code: string }>().code).toBe('REFRESH_TOKEN_UNKNOWN')
  })

  /**
   * THE SCENARIO THIS WHOLE DESIGN EXISTS FOR.
   *
   * An attacker steals a refresh token — from a stolen phone, a leaked log, a
   * compromised backup. Both parties now hold it. Whoever refreshes second
   * presents a consumed token, which cannot happen in honest use.
   */
  describe('stolen token', () => {
    it('revokes the entire family when a consumed token is presented again', async () => {
      const first = await login()
      const stolen = cookieFrom(first)

      // The legitimate user refreshes, consuming the token.
      const legitimate = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: stolen },
      })
      expect(legitimate.statusCode).toBe(200)
      const usersNewCookie = cookieFrom(legitimate)

      // The attacker now replays the stolen copy.
      const attacker = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: stolen },
      })
      expect(attacker.statusCode).toBe(401)
      expect(attacker.json<{ code: string }>().code).toBe('REFRESH_TOKEN_REUSE')

      // And critically: the legitimate user's NEW token is dead too. We cannot
      // tell which party is genuine, so we trust neither and force a password
      // re-authentication. Inconveniencing the real user once is far better
      // than leaving an attacker with a live session.
      const afterBreach = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: usersNewCookie },
      })
      expect(afterBreach.statusCode).toBe(401)
    })

    it('revokes every token in the family in the database', async () => {
      const first = await login()
      const stolen = cookieFrom(first)
      await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: stolen } })
      await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: stolen } })

      const tokens = await runWithoutTenantScope(
        { userId: null, requestId: 't', source: 'system', locale: 'en' },
        () => raw.refreshToken.findMany(),
      )
      expect(tokens.length).toBeGreaterThan(1)
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true)
    })

    it('clears the cookie so the client does not retry forever', async () => {
      const first = await login()
      const stolen = cookieFrom(first)
      await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: stolen } })
      const reuse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: stolen },
      })
      expect(String(reuse.headers['set-cookie'])).toContain('bf_refresh=;')
    })
  })

  it('refuses to refresh a suspended account', async () => {
    const first = await login()
    const cookie = cookieFrom(first)

    await runWithoutTenantScope(
      { userId: null, requestId: 't', source: 'system', locale: 'en' },
      () => raw.user.update({ where: { id: userId }, data: { status: 'suspended' } }),
    )

    // Without this check a suspended user could refresh their way to a live
    // session for the next 30 days.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /auth/logout', () => {
  it('revokes the family and clears the cookie', async () => {
    const first = await login()
    const cookie = cookieFrom(first)

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(204)

    const after = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie },
    })
    expect(after.statusCode).toBe(401)
  })

  it('returns 204 for an unknown token without disclosing that it was invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `bf_refresh=${randomBytes(32).toString('base64url')}` },
    })
    expect(res.statusCode).toBe(204)
  })
})

describe('health', () => {
  it('reports liveness without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ status: string }>().status).toBe('ok')
  })

  it('reports readiness with a database probe', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' })
    expect(res.statusCode).toBe(200)
  })
})
