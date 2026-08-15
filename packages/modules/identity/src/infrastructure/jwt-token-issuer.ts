import { SignJWT, jwtVerify } from 'jose'
import type { AccessTokenClaims, TokenIssuer } from '../domain/ports'
import type { CompanyId, UserId } from '@buildflow/core'

/**
 * HS256 JWT access tokens.
 *
 * WHY SYMMETRIC: only this platform issues and verifies these tokens. Asymmetric
 * signing exists so third parties can verify without the signing key, which is
 * not a requirement here — it would add key distribution and rotation
 * complexity for no benefit. Revisit if a partner ever needs to verify tokens
 * independently.
 *
 * WHAT IS NOT IN THE TOKEN: the permission set. Only `permHash` goes in. A
 * token carrying permissions stays valid until it expires, so revoking access
 * would take up to 15 minutes. With a hash, permissions are resolved
 * server-side from a 60-second cache and a revocation takes effect within that
 * window. It also keeps the token small — permission lists get long.
 * docs/11 §2.2
 */

const ISSUER = 'buildflow'
const AUDIENCE_APP = 'buildflow:app'
const ALGORITHM = 'HS256'

export class JwtTokenIssuer implements TokenIssuer {
  readonly #secret: Uint8Array

  constructor(
    secret: string,
    private readonly ttlSeconds = 15 * 60,
    private readonly audience: string = AUDIENCE_APP,
  ) {
    if (secret.length < 32) {
      // Fail at construction, not at first request. A short secret is a silent
      // downgrade of every token the platform will ever issue.
      throw new Error('JWT secret must be at least 32 characters')
    }
    this.#secret = new TextEncoder().encode(secret)
  }

  async issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({
      companyId: claims.companyId,
      sessionId: claims.sessionId,
      permHash: claims.permHash,
      roles: claims.roles,
    })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .setJti(crypto.randomUUID())
      .sign(this.#secret)
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.#secret, {
        issuer: ISSUER,
        // Audience is verified, not merely read. A portal token must not be
        // accepted by an internal endpoint — that separation is structural,
        // not a matter of which routes remember to check. docs/07 §7.13
        audience: this.audience,
        algorithms: [ALGORITHM],
      })

      return {
        sub: payload.sub as UserId,
        companyId: payload['companyId'] as CompanyId,
        sessionId: payload['sessionId'] as string,
        permHash: payload['permHash'] as string,
        roles: (payload['roles'] as string[] | undefined) ?? [],
      }
    } catch {
      // Expired, wrong signature, wrong audience, malformed — all are simply
      // "not authenticated" to the caller. Distinguishing them would tell an
      // attacker which part of their forgery to fix.
      return null
    }
  }
}
