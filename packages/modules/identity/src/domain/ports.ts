import type { CompanyId, UserId } from '@buildflow/core'
import type { User } from './user'
import type { RefreshTokenRecord, TokenFamilyId } from './refresh-token-family'

/**
 * Ports the identity domain depends on.
 *
 * Interfaces only — no Prisma, no argon2, no jose. The domain states what it
 * needs; infrastructure decides how. This is what lets the whole authentication
 * flow be tested with in-memory fakes and no container. docs/06 §4.3
 */

export interface UserRepository {
  findByEmail(companyId: CompanyId, email: string): Promise<User | null>
  findById(id: UserId): Promise<User | null>
  save(user: User): Promise<void>
}

export interface SessionRepository {
  create(session: NewSession): Promise<void>
  revoke(sessionId: string, reason: string): Promise<void>
  revokeAllForUser(userId: UserId, reason: string): Promise<number>
  touch(sessionId: string, at: Date): Promise<void>
}

export interface NewSession {
  id: string
  companyId: CompanyId
  userId: UserId
  deviceId?: string | undefined
  deviceName?: string | undefined
  platform?: string | undefined
  ipAddress?: string | undefined
  userAgent?: string | undefined
  expiresAt: Date
}

export interface RefreshTokenRepository {
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>
  issue(token: NewRefreshToken): Promise<void>
  markUsed(id: string, at: Date): Promise<void>
  /** Revokes every token descended from one login. The reuse-detection hammer. */
  revokeFamily(familyId: TokenFamilyId, reason: string, at: Date): Promise<number>
}

export interface NewRefreshToken {
  id: string
  companyId: CompanyId
  sessionId: string
  userId: UserId
  tokenHash: string
  familyId: TokenFamilyId
  parentId: string | null
  expiresAt: Date
}

/**
 * Password hashing.
 *
 * `verify` takes the stored hash first so an implementation cannot accidentally
 * short-circuit on a missing hash — see the dummy-verify note in LoginHandler.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>
  verify(storedHash: string, plaintext: string): Promise<boolean>
  /** True when the hash was produced with outdated parameters and should be upgraded. */
  needsRehash(storedHash: string): boolean
}

export interface AccessTokenClaims {
  sub: UserId
  companyId: CompanyId
  sessionId: string
  /**
   * Hash of the user's effective permission set, NOT the set itself.
   *
   * Keeps the token small and — more importantly — means a permission
   * revocation takes effect within the cache TTL rather than waiting out the
   * token's lifetime. docs/11 §2.2
   */
  permHash: string
  roles: string[]
}

export interface TokenIssuer {
  issueAccessToken(claims: AccessTokenClaims): Promise<string>
  verifyAccessToken(token: string): Promise<AccessTokenClaims | null>
}

/** Brute-force telemetry. Separate from the audit log: this records attempts
 *  against emails that may not correspond to any account. */
export interface LoginAttemptRecorder {
  record(attempt: {
    email: string
    companyId: CompanyId | null
    ipAddress?: string | undefined
    userAgent?: string | undefined
    success: boolean
    failureReason?: string | undefined
  }): Promise<void>
}
