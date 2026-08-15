import {
  type Clock,
  type DomainError,
  type IdGenerator,
  type Result,
  err,
  ok,
  unauthorizedError,
} from '@buildflow/core'
import type {
  RefreshTokenRepository,
  SessionRepository,
  TokenIssuer,
  UserRepository,
} from '../domain/ports'
import { evaluateRefresh, generateRefreshToken, hashToken } from '../domain/refresh-token-family'
import type { AuthTokens } from './login.handler'

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface RefreshCommand {
  refreshToken: string
  ipAddress?: string | undefined
}

export interface SecurityAlerter {
  refreshTokenReuseDetected(input: {
    userId: string
    companyId: string
    familyId: string
    ipAddress?: string | undefined
  }): Promise<void>
}

/**
 * Rotates a refresh token, or detects theft and revokes the family.
 *
 * The decision itself lives in the pure `evaluateRefresh` domain function; this
 * handler performs the writes it implies. That split is what makes the security
 * behaviour unit-testable without a database.
 */
export class RefreshHandler {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly alerter: SecurityAlerter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly permHashes?: { hashFor(c: never, u: never): Promise<string> },
  ) {}

  private async resolvePermHash(companyId: unknown, userId: unknown): Promise<string> {
    if (!this.permHashes) return 'unresolved'
    try {
      return await this.permHashes.hashFor(companyId as never, userId as never)
    } catch {
      return 'unresolved'
    }
  }

  async execute(command: RefreshCommand): Promise<Result<AuthTokens, DomainError>> {
    const now = this.clock.now()
    const presentedHash = await hashToken(command.refreshToken)
    const record = await this.refreshTokens.findByHash(presentedHash)

    const outcome = evaluateRefresh(record, now)
    if (outcome.isErr()) return err(outcome.error)

    if (outcome.value.kind === 'reuse_detected') {
      // ⚠️ THEFT. Two parties hold this token. We cannot tell which is the
      // legitimate user, so we trust neither: the whole family dies and both
      // must re-authenticate with the password. Inconveniencing the real user
      // once is vastly preferable to leaving an attacker with a live session.
      const { familyId } = outcome.value
      await this.refreshTokens.revokeFamily(familyId, outcome.value.reason, now)
      if (record) {
        await this.sessions.revoke(record.sessionId, 'refresh_token_reuse')
        await this.alerter.refreshTokenReuseDetected({
          userId: record.userId,
          companyId: record.companyId,
          familyId,
          ipAddress: command.ipAddress,
        })
      }
      return err(
        unauthorizedError(
          'REFRESH_TOKEN_REUSE',
          'Session revoked — this refresh token had already been used',
        ),
      )
    }

    const consumed = outcome.value.consumed

    // Consume before issuing. If the process dies between the two, the user
    // re-authenticates — annoying. Issuing first and dying would leave a live
    // token that was never consumed, which is a security hole. Order matters.
    await this.refreshTokens.markUsed(consumed.id, now)

    // Re-check the account between issuing tokens: a user suspended since login
    // must not be able to keep refreshing their way to a live session for the
    // next 30 days.
    const user = await this.users.findById(consumed.userId)
    if (!user) return err(unauthorizedError('ACCOUNT_MISSING', 'Account no longer exists'))
    const eligible = user.canAttemptLogin(now)
    if (eligible.isErr()) {
      await this.refreshTokens.revokeFamily(consumed.familyId, 'account_not_eligible', now)
      return err(eligible.error)
    }

    const nextToken = generateRefreshToken()
    await this.refreshTokens.issue({
      id: this.ids.next<'RefreshTokenId'>(),
      companyId: consumed.companyId,
      sessionId: consumed.sessionId,
      userId: consumed.userId,
      tokenHash: await hashToken(nextToken),
      // Same family: the chain from one login stays linked, so reuse anywhere
      // in it revokes everything descended from that login.
      familyId: consumed.familyId,
      parentId: consumed.id,
      expiresAt: new Date(this.clock.timestamp() + REFRESH_TOKEN_TTL_MS),
    })

    await this.sessions.touch(consumed.sessionId, now)

    const accessToken = await this.tokens.issueAccessToken({
      sub: consumed.userId,
      companyId: consumed.companyId,
      sessionId: consumed.sessionId,
      // Re-resolved on every refresh, so a permission change lands on the next
      // token rather than persisting for the refresh token's lifetime.
      permHash: await this.resolvePermHash(consumed.companyId, consumed.userId),
      roles: [],
    })

    return ok({
      accessToken,
      refreshToken: nextToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionId: consumed.sessionId,
    })
  }
}
