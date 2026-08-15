import {
  AggregateRoot,
  type Clock,
  type CompanyId,
  type DomainError,
  type UserId,
  type Result,
  err,
  ok,
  forbiddenError,
  unauthorizedError,
  validationError,
} from '@buildflow/core'

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deactivated'

export interface UserSnapshot {
  id: UserId
  companyId: CompanyId
  email: string
  passwordHash: string
  status: UserStatus
  failedLoginCount: number
  lockedUntil: Date | null
  lastLoginAt: Date | null
  mfaEnabled: boolean
  version: number
}

/**
 * Lockout policy.
 *
 * Progressive rather than fixed: the first few failures are almost always a
 * genuine typo on a phone keyboard, and locking a site engineer out for 15
 * minutes over a fat-fingered password on a live site is a support call and a
 * reason to stop using the app. Sustained failures are an attack and escalate
 * sharply.
 *
 * Lockout is per-account. Per-IP rate limiting is a separate, complementary
 * control at the edge — neither alone is sufficient: per-account lockout does
 * nothing against spraying many accounts from one IP, and per-IP limits do
 * nothing against a distributed attack on one account. docs/11 §2.1
 */
const LOCKOUT_THRESHOLDS: ReadonlyArray<{ afterFailures: number; lockMinutes: number }> = [
  { afterFailures: 5, lockMinutes: 1 },
  { afterFailures: 7, lockMinutes: 5 },
  { afterFailures: 10, lockMinutes: 30 },
  { afterFailures: 15, lockMinutes: 24 * 60 },
]

export class User extends AggregateRoot<UserId> {
  #email: string
  #passwordHash: string
  #status: UserStatus
  #failedLoginCount: number
  #lockedUntil: Date | null
  #lastLoginAt: Date | null
  #mfaEnabled: boolean

  private constructor(
    id: UserId,
    readonly companyId: CompanyId,
    snapshot: Omit<UserSnapshot, 'id' | 'companyId'>,
  ) {
    super(id, snapshot.version)
    this.#email = snapshot.email
    this.#passwordHash = snapshot.passwordHash
    this.#status = snapshot.status
    this.#failedLoginCount = snapshot.failedLoginCount
    this.#lockedUntil = snapshot.lockedUntil
    this.#lastLoginAt = snapshot.lastLoginAt
    this.#mfaEnabled = snapshot.mfaEnabled
  }

  static restore(snapshot: UserSnapshot): User {
    return new User(snapshot.id, snapshot.companyId, snapshot)
  }

  get email(): string {
    return this.#email
  }
  get passwordHash(): string {
    return this.#passwordHash
  }
  get status(): UserStatus {
    return this.#status
  }
  get failedLoginCount(): number {
    return this.#failedLoginCount
  }
  get lockedUntil(): Date | null {
    return this.#lockedUntil
  }
  get lastLoginAt(): Date | null {
    return this.#lastLoginAt
  }
  get mfaEnabled(): boolean {
    return this.#mfaEnabled
  }

  isLocked(now: Date): boolean {
    return this.#lockedUntil !== null && this.#lockedUntil.getTime() > now.getTime()
  }

  /**
   * Checks whether this account may attempt authentication at all.
   *
   * Called BEFORE password verification so a suspended account cannot be probed
   * for a valid password. Note the deliberately uniform error surface — see
   * `recordFailedLogin`.
   */
  canAttemptLogin(now: Date): Result<void, DomainError> {
    if (this.#status === 'suspended' || this.#status === 'deactivated') {
      return err(forbiddenError('ACCOUNT_DISABLED', `Account is ${this.#status}`))
    }
    if (this.#status === 'invited') {
      return err(forbiddenError('ACCOUNT_NOT_ACTIVATED', 'Invitation has not been accepted'))
    }
    if (this.isLocked(now)) {
      return err(
        unauthorizedError('ACCOUNT_LOCKED', 'Account is temporarily locked', {
          until: this.#lockedUntil?.toISOString() ?? '',
        }),
      )
    }
    return ok()
  }

  recordSuccessfulLogin(clock: Clock): void {
    this.#failedLoginCount = 0
    this.#lockedUntil = null
    this.#lastLoginAt = clock.now()
  }

  /**
   * Records a failure and applies progressive lockout.
   *
   * The caller must return the SAME generic error for "no such user" and "wrong
   * password". Distinguishing them turns the login endpoint into a user
   * enumeration oracle — an attacker learns which emails are registered, which
   * is exactly the reconnaissance step before a credential-stuffing run.
   */
  recordFailedLogin(clock: Clock): void {
    this.#failedLoginCount += 1
    const applicable = [...LOCKOUT_THRESHOLDS]
      .reverse()
      .find((t) => this.#failedLoginCount >= t.afterFailures)

    if (applicable) {
      this.#lockedUntil = new Date(clock.timestamp() + applicable.lockMinutes * 60_000)
    }
  }

  changePassword(newHash: string, clock: Clock): Result<void, DomainError> {
    if (newHash === this.#passwordHash) {
      return err(
        validationError('PASSWORD_REUSED', 'New password must differ from the current one'),
      )
    }
    this.#passwordHash = newHash
    // A password change ends every other session: if the change was prompted by
    // a suspected compromise, leaving other sessions alive defeats the point.
    // The caller revokes sessions on this event.
    this.#failedLoginCount = 0
    this.#lockedUntil = null
    this.raisePasswordChanged(clock)
    return ok()
  }

  activate(): Result<void, DomainError> {
    if (this.#status !== 'invited') {
      return err(validationError('ALREADY_ACTIVATED', 'Account is not awaiting activation'))
    }
    this.#status = 'active'
    return ok()
  }

  suspend(): void {
    this.#status = 'suspended'
  }

  toSnapshot(): UserSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      email: this.#email,
      passwordHash: this.#passwordHash,
      status: this.#status,
      failedLoginCount: this.#failedLoginCount,
      lockedUntil: this.#lockedUntil,
      lastLoginAt: this.#lastLoginAt,
      mfaEnabled: this.#mfaEnabled,
      version: this.version,
    }
  }

  private raisePasswordChanged(clock: Clock): void {
    this.raise({
      eventId: crypto.randomUUID() as never,
      eventType: 'identity.password_changed',
      occurredAt: clock.now(),
      companyId: this.companyId,
      actorId: this.id,
      aggregateType: 'User',
      aggregateId: this.id,
      eventVersion: 1,
      payload: { userId: this.id },
    })
  }
}
