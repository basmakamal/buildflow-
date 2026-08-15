import type { FastifyReply, FastifyRequest } from 'fastify'
import { runWithTenantContext } from '@buildflow/database'
import {
  canInScope,
  type Permission,
  type Principal,
  type ResourceScope,
} from '@buildflow/identity'
import type { Container } from '../container'
import { problem } from '../server'

/**
 * Authentication and authorization guards.
 *
 * Three layers, all enforced HERE, server-side, on every protected route. The
 * client also knows the permission set — returned by /auth/me — but only so it
 * can hide what the user cannot do. That is honesty in the interface, not
 * security; the interface cannot be lied to because these checks do not trust
 * it. docs/11 §3.1
 */

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal
  }
}

/**
 * Verifies the access token, resolves the principal, and establishes tenant
 * context for the remainder of the request.
 *
 * Permissions are resolved SERVER-SIDE from a 60-second cache rather than read
 * from the token. The token carries only `permHash`, so revoking a permission
 * takes effect within that window instead of waiting out the token's 15-minute
 * lifetime. docs/11 §2.2
 */
export function authenticate(c: Container) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      await reply
        .status(401)
        .send(problem('UNAUTHENTICATED', 'Missing bearer token', 401, request.id))
      return
    }

    const claims = await c.tokens.verifyAccessToken(header.slice(7))
    if (!claims) {
      // Expired, forged, wrong audience, malformed — all indistinguishable to
      // the caller. Telling them which would say which part to fix.
      await reply
        .status(401)
        .send(problem('INVALID_TOKEN', 'Access token is not valid', 401, request.id))
      return
    }

    await new Promise<void>((resolve, reject) => {
      runWithTenantContext(
        {
          companyId: claims.companyId,
          userId: claims.sub,
          requestId: request.id,
          source: 'api',
          locale: request.headers['accept-language']?.slice(0, 5) ?? 'ar',
        },
        () => {
          c.permissions
            .resolve(claims.companyId, claims.sub)
            .then((principal) => {
              request.principal = principal
              resolve()
            })
            .catch(reject)
        },
      )
    })
  }
}

/**
 * Requires a permission, optionally within a resource scope.
 *
 * Returns 403 when the principal is authenticated but lacks the permission.
 * Note what it does NOT do: it never reports whether the scoped resource
 * exists. Route handlers return 404 for a resource outside the caller's tenant,
 * because a 403 would confirm existence and turn an authorization control into
 * an information-disclosure channel. docs/07 §12
 */
export function requirePermission(
  permission: Permission,
  scopeFrom?: (request: FastifyRequest) => ResourceScope,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const principal = request.principal
    if (!principal) {
      // authenticate() must run first. Reaching here means the route is
      // misconfigured, and failing closed is the only safe response.
      await reply
        .status(401)
        .send(problem('UNAUTHENTICATED', 'Authentication required', 401, request.id))
      return
    }

    const scope = scopeFrom?.(request) ?? {}
    if (!canInScope(principal, permission, scope)) {
      request.log.warn({ userId: principal.userId, permission, scope }, 'authorization denied')
      await reply
        .status(403)
        .send(
          problem(
            'FORBIDDEN',
            'You do not have permission to perform this action',
            403,
            request.id,
          ),
        )
    }
  }
}

/**
 * Narrows `request.principal` after `authenticate` has run.
 *
 * Throws rather than returning undefined: reaching a guarded handler without a
 * principal means the route is misconfigured, and a 500 that surfaces that
 * beats silently treating the caller as anonymous.
 */
export function principalOf(request: FastifyRequest): Principal {
  const principal = request.principal
  if (!principal) {
    throw new Error('Route is missing the authenticate() preHandler')
  }
  return principal
}
