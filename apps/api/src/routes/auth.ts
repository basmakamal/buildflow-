import type { FastifyInstance } from 'fastify'
import { runWithTenantContext } from '@buildflow/database'
import { hashToken } from '@buildflow/identity'
import type { Container } from '../container'
import { problem, statusFor } from '../server'

/**
 * Authentication routes.
 *
 * Controllers parse, dispatch, and present — nothing else. Every rule about
 * lockout, enumeration resistance, and token rotation lives in the domain and
 * application layers, which is why these functions are so short. docs/06 §6.2
 */

const REFRESH_COOKIE = 'bf_refresh'

export function registerAuthRoutes(app: FastifyInstance, c: Container): void {
  app.post<{
    Body: { companyId: string; email: string; password: string; deviceName?: string }
  }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['companyId', 'email', 'password'],
          properties: {
            companyId: { type: 'string', minLength: 36, maxLength: 36 },
            email: { type: 'string', minLength: 3, maxLength: 255 },
            // No maxLength trap: a long passphrase is a GOOD password and must
            // not be rejected. The floor exists; there is deliberately no
            // low ceiling. 1024 only bounds a hostile payload.
            password: { type: 'string', minLength: 8, maxLength: 1024 },
            deviceName: { type: 'string', maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const { companyId, email, password, deviceName } = request.body

      // Context is established HERE, not in the onRequest hook: that hook runs
      // before body parsing, so the tenant is not yet knowable there.
      const result = await runWithTenantContext(
        {
          companyId: companyId as never,
          userId: null,
          requestId: request.id,
          source: 'api',
          locale: 'ar',
        },
        () =>
          c.login.execute({
            companyId: companyId as never,
            email,
            password,
            deviceName,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          }),
      )

      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      const tokens = result.value
      return reply
        .setCookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions())
        .status(200)
        .send({
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
          sessionId: tokens.sessionId,
        })
    },
  )

  /**
   * Refresh. The refresh token arrives in an httpOnly cookie, never a body.
   *
   * A token readable by JavaScript is a token an XSS can exfiltrate, and this
   * one is valid for 30 days. docs/11 §2.2
   */
  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE]
    if (!presented) {
      return reply
        .status(401)
        .send(problem('REFRESH_TOKEN_MISSING', 'No refresh token supplied', 401, request.id))
    }

    // Resolve the tenant FROM the token rather than trusting a client-asserted
    // company. The lookup is the one audited cross-tenant read in the system.
    const record = await c.refreshTokens.findByHash(await hashToken(presented))
    if (!record) {
      return reply
        .status(401)
        .send(problem('REFRESH_TOKEN_UNKNOWN', 'Refresh token not recognised', 401, request.id))
    }

    const result = await runWithTenantContext(
      {
        companyId: record.companyId,
        userId: record.userId,
        requestId: request.id,
        source: 'api',
        locale: 'ar',
      },
      () => c.refresh.execute({ refreshToken: presented, ipAddress: request.ip }),
    )

    if (result.isErr()) {
      // Clear the cookie on any refresh failure — including reuse detection.
      // Leaving a dead token in the browser produces an infinite retry loop
      // that looks, to the user, like the app is broken.
      return reply
        .clearCookie(REFRESH_COOKIE, { path: '/' })
        .status(statusFor(result.error))
        .send(problem(result.error.code, result.error.message, statusFor(result.error), request.id))
    }

    const tokens = result.value
    return reply
      .setCookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions())
      .status(200)
      .send({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        sessionId: tokens.sessionId,
      })
  })

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE]
    if (presented) {
      const record = await c.refreshTokens.findByHash(await hashToken(presented))
      if (record) {
        await runWithTenantContext(
          {
            companyId: record.companyId,
            userId: record.userId,
            requestId: request.id,
            source: 'api',
            locale: 'ar',
          },
          async () => {
            // Revoke the whole family, not just this token. A logout that left
            // descendants alive would not be a logout.
            await c.refreshTokens.revokeFamily(record.familyId, 'logout', new Date())
            await c.sessions.revoke(record.sessionId, 'logout')
          },
        )
      }
    }
    // Always 204, even for an unknown token: whether a token was valid is not
    // something an unauthenticated caller should be able to probe.
    return reply.clearCookie(REFRESH_COOKIE, { path: '/' }).status(204).send()
  })
}

function refreshCookieOptions() {
  return {
    httpOnly: true, // unreadable from JavaScript — XSS cannot exfiltrate it
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict' as const, // CSRF defence
    path: '/api/v1/auth', // sent only to the endpoints that need it
    maxAge: 30 * 24 * 60 * 60,
  }
}
