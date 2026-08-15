import {
  type Clock,
  type CompanyId,
  type DomainError,
  type IdGenerator,
  type Result,
  type UserId,
  err,
  ok,
  unauthorizedError,
} from '@buildflow/core'
import type {
  LoginAttemptRecorder,
  PasswordHasher,
  RefreshTokenRepository,
  SessionRepository,
  TokenIssuer,
  UserRepository,
} from '../domain/ports'
import { generateRefreshToken, hashToken } from '../domain/refresh-token-family'

/**
 * Supplies the fingerprint of the user's effective permissions for the token.
 *
 * A port rather than a direct dependency: the handler must stay testable with
 * no database, and login must not fail because permission resolution had a bad
 * day — see the fallback below.
 */
export interface PermHashProvider {
  hashFor(companyId: CompanyId, userId: UserId): Promise<string>
}

export interface LoginCommand {
  companyId: CompanyId
  email: string
  password: string
  deviceId?: string | undefined
  deviceName?: string | undefined
  platform?: string | undefined
  ipAddress?: string | undefined
  userAgent?: string | undefined
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  sessionId: string
}

/**
 * Access tokens are short so a leaked one has a small blast radius; refresh
 * tokens are long so a site engineer is not re-authenticating on a roof.
 * docs/11 §2.2
 */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * A pre-computed argon2id hash of a random string, used to spend the same CPU
 * time when no account exists as when one does.
 *
 * WHY: without it, an unknown email returns in ~1ms (no hash to verify) while a
 * known email takes ~250ms (argon2id by design). That difference is trivially
 * measurable over a network and turns login into a user-enumeration oracle —
 * which is precisely the reconnaissance step before credential stuffing.
 * Returning an identical error message is not enough on its own; the timing
 * must match too.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG'

export class LoginHandler {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly attempts: LoginAttemptRecorder,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly permHashes?: PermHashProvider,
  ) {}

  async execute(command: LoginCommand): Promise<Result<AuthTokens, DomainError>> {
    const now = this.clock.now()
    const email = command.email.trim().toLowerCase()

    const user = await this.users.findByEmail(command.companyId, email)

    // Burn equivalent CPU when the account does not exist. See DUMMY_HASH.
    if (!user) {
      await this.hasher.verify(DUMMY_HASH, command.password)
      await this.recordFailure(command, email, 'unknown_account')
      return err(INVALID_CREDENTIALS)
    }

    const eligible = user.canAttemptLogin(now)
    if (eligible.isErr()) {
      await this.recordFailure(command, email, eligible.error.code.toLowerCase())
      // Lockout and disabled states ARE surfaced distinctly. That leaks the
      // existence of the account, but the alternative — a user locked out with
      // no explanation, repeatedly retrying a correct password — generates
      // support calls and teaches people the product is broken. The account is
      // already unusable at this point, so the marginal disclosure is small and
      // the usability gain is large. A deliberate trade, not an oversight.
      return err(eligible.error)
    }

    const valid = await this.hasher.verify(user.passwordHash, command.password)
    if (!valid) {
      user.recordFailedLogin(this.clock)
      await this.users.save(user)
      await this.recordFailure(command, email, 'bad_password')
      return err(INVALID_CREDENTIALS)
    }

    // Transparent upgrade when argon2 parameters have been hardened since this
    // password was last set — the user never notices.
    if (this.hasher.needsRehash(user.passwordHash)) {
      const upgraded = await this.hasher.hash(command.password)
      user.changePassword(upgraded, this.clock)
    }

    user.recordSuccessfulLogin(this.clock)
    await this.users.save(user)

    const sessionId = this.ids.next<'SessionId'>()
    await this.sessions.create({
      id: sessionId,
      companyId: command.companyId,
      userId: user.id,
      deviceId: command.deviceId,
      deviceName: command.deviceName,
      platform: command.platform,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      expiresAt: new Date(this.clock.timestamp() + REFRESH_TOKEN_TTL_MS),
    })

    const refreshToken = generateRefreshToken()
    const familyId = this.ids.next<'TokenFamilyId'>()
    await this.refreshTokens.issue({
      id: this.ids.next<'RefreshTokenId'>(),
      companyId: command.companyId,
      sessionId,
      userId: user.id,
      tokenHash: await hashToken(refreshToken),
      familyId,
      parentId: null,
      expiresAt: new Date(this.clock.timestamp() + REFRESH_TOKEN_TTL_MS),
    })

    const accessToken = await this.tokens.issueAccessToken({
      sub: user.id,
      companyId: command.companyId,
      sessionId,
      permHash: await this.resolvePermHash(command.companyId, user.id),
      roles: [],
    })

    await this.attempts.record({
      email,
      companyId: command.companyId,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      success: true,
    })

    return ok({ accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, sessionId })
  }

  /**
   * Resolves the permission fingerprint, degrading to a sentinel on failure.
   *
   * permHash is a cache-coherency hint, not an authorization decision — the
   * guard resolves permissions server-side regardless. So a resolver outage
   * must not block a legitimate login: failing open HERE is safe precisely
   * because nothing downstream trusts this value to grant anything.
   */
  private async resolvePermHash(companyId: CompanyId, userId: UserId): Promise<string> {
    if (!this.permHashes) return 'unresolved'
    try {
      return await this.permHashes.hashFor(companyId, userId)
    } catch {
      return 'unresolved'
    }
  }

  private async recordFailure(command: LoginCommand, email: string, reason: string): Promise<void> {
    await this.attempts.record({
      email,
      companyId: command.companyId,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      success: false,
      failureReason: reason,
    })
  }
}

/**
 * ONE error for "no such account" and "wrong password".
 *
 * Distinguishing them tells an attacker which emails are registered, which is
 * the reconnaissance step before credential stuffing. The `failureReason`
 * recorded internally is precise; what the client sees is not.
 */
const INVALID_CREDENTIALS: DomainError = unauthorizedError(
  'INVALID_CREDENTIALS',
  'Email or password is incorrect',
)
