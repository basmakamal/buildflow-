import {
  type Result,
  ok,
  err,
  type DomainError,
  type CompanyId,
  type UserId,
  unauthorizedError,
} from '@buildflow/core'

/**
 * Rotating refresh tokens with reuse detection.
 *
 * THE ATTACK THIS DEFEATS: an attacker steals a refresh token — from a stolen
 * phone, a compromised backup, a leaked log. With static refresh tokens they
 * have a 30-day credential and nobody ever finds out.
 *
 * With rotation, each refresh consumes the presented token and issues a new one
 * in the same family. So exactly one of two things happens next:
 *
 *   • the attacker refreshes first → the legitimate user's next refresh presents
 *     an already-used token
 *   • the user refreshes first     → the attacker's next attempt presents one
 *
 * Either way a CONSUMED token is presented, which cannot happen in honest use.
 * That is unambiguous evidence of theft, so the entire family is revoked and
 * the user is told. The stolen token is usable at most once, and the compromise
 * is detected rather than silently exploited for a month.
 *
 * This is the highest-value control in the authentication design. docs/11 §2.3
 */

export type TokenFamilyId = string

export interface RefreshTokenRecord {
  readonly id: string
  readonly companyId: CompanyId
  readonly sessionId: string
  readonly userId: UserId
  readonly tokenHash: string
  readonly familyId: TokenFamilyId
  readonly parentId: string | null
  readonly issuedAt: Date
  readonly expiresAt: Date
  readonly usedAt: Date | null
  readonly revokedAt: Date | null
}

export type RotationOutcome =
  | { kind: 'rotate'; consumed: RefreshTokenRecord }
  | { kind: 'reuse_detected'; familyId: TokenFamilyId; reason: string }

/**
 * Decides what a presented refresh token means. Pure — no I/O, no clock
 * reading, fully unit-testable. The caller performs the resulting writes.
 */
export function evaluateRefresh(
  presented: RefreshTokenRecord | null,
  now: Date,
): Result<RotationOutcome, DomainError> {
  if (!presented) {
    // Unknown token. Could be forged, or from a family already revoked and
    // pruned. Either way there is nothing to revoke and nothing to issue.
    return err(unauthorizedError('REFRESH_TOKEN_UNKNOWN', 'Refresh token not recognised'))
  }

  if (presented.revokedAt) {
    // Presenting a revoked token is also suspicious, but the family is already
    // dead — re-revoking changes nothing.
    return err(unauthorizedError('REFRESH_TOKEN_REVOKED', 'Refresh token has been revoked'))
  }

  if (presented.usedAt) {
    // ⚠️ THE SIGNAL. In honest use a token is presented exactly once, because
    // the client replaces it on receipt. A second presentation means two
    // parties hold it.
    return ok({
      kind: 'reuse_detected',
      familyId: presented.familyId,
      reason: 'Refresh token reuse detected — token presented after it was consumed',
    })
  }

  if (presented.expiresAt.getTime() <= now.getTime()) {
    return err(unauthorizedError('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired'))
  }

  return ok({ kind: 'rotate', consumed: presented })
}

/**
 * Hashes a refresh token for storage.
 *
 * SHA-256 rather than argon2 deliberately: the token is 256 bits of CSPRNG
 * output, not a human-chosen password, so there is no dictionary to attack and
 * no need for a slow KDF. Refresh happens on every access-token expiry, so a
 * deliberately slow hash here would add latency to a very hot path for no
 * security gain. Passwords are a different problem and use argon2id.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 256 bits from a CSPRNG, base64url — never Math.random. */
export function generateRefreshToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
