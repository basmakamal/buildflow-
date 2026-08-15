import { runWithoutTenantScope, type Database } from '@buildflow/database'
import type { CompanyId, UserId } from '@buildflow/core'
import { User, type UserStatus } from '../domain/user'
import type { RefreshTokenRecord } from '../domain/refresh-token-family'
import type {
  LoginAttemptRecorder,
  NewRefreshToken,
  NewSession,
  RefreshTokenRepository,
  SessionRepository,
  UserRepository,
} from '../domain/ports'

/**
 * Prisma implementations of the identity ports.
 *
 * Every query here goes through the tenant-scoped client, so `companyId` is
 * injected below this layer and cannot be omitted. The repositories therefore
 * read as if the tenant did not exist — which is the point.
 *
 * The exceptions are deliberate and marked: refresh-token lookups are keyed by
 * a globally unique token hash and must resolve before any tenant is known.
 * docs/06 §5.2
 */

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(_companyId: CompanyId, email: string): Promise<User | null> {
    // companyId is injected by the tenant extension; the parameter exists to
    // keep the port honest about what identifies a user.
    const row = await this.db.user.findFirst({ where: { email, deletedAt: null } })
    return row ? toUser(row) : null
  }

  async findById(id: UserId): Promise<User | null> {
    const row = await this.db.user.findFirst({ where: { id, deletedAt: null } })
    return row ? toUser(row) : null
  }

  async save(user: User): Promise<void> {
    const snapshot = user.toSnapshot()
    // Optimistic concurrency: a stale write updates zero rows rather than
    // silently overwriting a concurrent change. Field crews on flaky
    // connections generate these constantly. docs/02 §5
    const result = await this.db.user.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        passwordHash: snapshot.passwordHash,
        status: snapshot.status,
        failedLoginCount: snapshot.failedLoginCount,
        lockedUntil: snapshot.lockedUntil,
        lastLoginAt: snapshot.lastLoginAt,
        mfaEnabled: snapshot.mfaEnabled,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of User ${snapshot.id}`)
    }
  }
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async create(session: NewSession): Promise<void> {
    await this.db.session.create({
      data: {
        id: session.id,
        userId: session.userId,
        deviceId: session.deviceId ?? null,
        deviceName: session.deviceName ?? null,
        platform: session.platform ?? null,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        expiresAt: session.expiresAt,
      } as never,
    })
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    })
  }

  async revokeAllForUser(userId: UserId, reason: string): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    })
    return result.count
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db.session.updateMany({ where: { id: sessionId }, data: { lastSeenAt: at } })
  }
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Database) {}

  /**
   * Looked up by token hash alone, OUTSIDE tenant scope.
   *
   * This is one of the few legitimate cross-tenant reads in the system, and it
   * is unavoidable: at refresh time the caller presents nothing but an opaque
   * bearer token. There is no authenticated tenant yet — resolving the tenant
   * is the *purpose* of this query. Scoping it would require the client to
   * assert which company it belongs to, and trusting a client's claim about
   * that is exactly what tenant isolation exists to avoid.
   *
   * Safe because the lookup key is 256 bits of CSPRNG output behind a unique
   * index: it cannot be guessed or enumerated, and possession of the token IS
   * the authorisation. The returned record carries the authoritative companyId,
   * and every subsequent operation in the refresh flow runs scoped to it.
   *
   * The bypass covers this ONE query and nothing else. docs/11 §4
   */
  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await runWithoutTenantScope(
      { userId: null, requestId: 'refresh-token-lookup', source: 'api', locale: 'en' },
      () => this.db.refreshToken.findFirst({ where: { tokenHash } }),
    )
    if (!row) return null
    return {
      id: row.id,
      companyId: row.companyId as CompanyId,
      sessionId: row.sessionId,
      userId: row.userId as UserId,
      tokenHash: row.tokenHash,
      familyId: row.familyId,
      parentId: row.parentId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
    }
  }

  async issue(token: NewRefreshToken): Promise<void> {
    await this.db.refreshToken.create({
      data: {
        id: token.id,
        sessionId: token.sessionId,
        userId: token.userId,
        tokenHash: token.tokenHash,
        familyId: token.familyId,
        parentId: token.parentId,
        expiresAt: token.expiresAt,
      } as never,
    })
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.db.refreshToken.updateMany({ where: { id }, data: { usedAt: at } })
  }

  /**
   * Revokes every token descended from one login — the reuse-detection hammer.
   *
   * Revokes ALL tokens in the family, used and unused alike. A partial revoke
   * would leave the attacker's most recent token alive, which is the entire
   * thing this defends against. docs/11 §2.3
   */
  async revokeFamily(familyId: string, reason: string, at: Date): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at, revokeReason: reason.slice(0, 120) },
    })
    return result.count
  }
}

export class PrismaLoginAttemptRecorder implements LoginAttemptRecorder {
  constructor(
    private readonly db: Database,
    private readonly generateId: () => string,
  ) {}

  async record(attempt: {
    email: string
    companyId: CompanyId | null
    ipAddress?: string | undefined
    userAgent?: string | undefined
    success: boolean
    failureReason?: string | undefined
  }): Promise<void> {
    // Recorded on a best-effort basis: brute-force telemetry must never be the
    // reason a legitimate login fails.
    try {
      await this.db.loginAttempt.create({
        data: {
          id: this.generateId(),
          email: attempt.email.slice(0, 255),
          companyId: attempt.companyId,
          ipAddress: attempt.ipAddress ?? null,
          userAgent: attempt.userAgent?.slice(0, 400) ?? null,
          success: attempt.success,
          failureReason: attempt.failureReason ?? null,
        },
      })
    } catch {
      // Swallowed deliberately — see above.
    }
  }
}

function toUser(row: {
  id: string
  companyId: string
  email: string
  passwordHash: string
  status: string
  failedLoginCount: number
  lockedUntil: Date | null
  lastLoginAt: Date | null
  mfaEnabled: boolean
  version: number
}): User {
  return User.restore({
    id: row.id as UserId,
    companyId: row.companyId as CompanyId,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status as UserStatus,
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    mfaEnabled: row.mfaEnabled,
    version: row.version,
  })
}
