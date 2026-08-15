import { describe, it, expect } from 'vitest'
import { FixedClock, type CompanyId, type UserId } from '@buildflow/core'
import { User, type UserSnapshot } from '../src/domain/user'

const START = new Date('2026-06-01T12:00:00.000Z')

const user = (over: Partial<UserSnapshot> = {}): User =>
  User.restore({
    id: 'usr-1' as UserId,
    companyId: 'co-1' as CompanyId,
    email: 'khaled@acme.sa',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    status: 'active',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mfaEnabled: false,
    version: 1,
    ...over,
  })

describe('User lockout policy', () => {
  it('permits login when active and unlocked', () => {
    expect(user().canAttemptLogin(START).isOk()).toBe(true)
  })

  describe('progressive lockout', () => {
    // Early failures are almost always a typo on a phone keyboard on a live
    // site. Locking a site engineer out for 15 minutes over that is a support
    // call and a reason to stop using the app. Sustained failures escalate.
    it('does not lock before the fifth failure', () => {
      const clock = new FixedClock(START)
      const u = user()
      for (let i = 0; i < 4; i++) u.recordFailedLogin(clock)
      expect(u.isLocked(clock.now())).toBe(false)
      expect(u.failedLoginCount).toBe(4)
    })

    it('locks for 1 minute at the fifth failure', () => {
      const clock = new FixedClock(START)
      const u = user()
      for (let i = 0; i < 5; i++) u.recordFailedLogin(clock)
      expect(u.isLocked(clock.now())).toBe(true)
      expect(u.lockedUntil!.getTime()).toBe(START.getTime() + 60_000)
    })

    it('escalates to 30 minutes at ten failures', () => {
      const clock = new FixedClock(START)
      const u = user()
      for (let i = 0; i < 10; i++) u.recordFailedLogin(clock)
      expect(u.lockedUntil!.getTime()).toBe(START.getTime() + 30 * 60_000)
    })

    it('escalates to 24 hours at fifteen failures', () => {
      const clock = new FixedClock(START)
      const u = user()
      for (let i = 0; i < 15; i++) u.recordFailedLogin(clock)
      expect(u.lockedUntil!.getTime()).toBe(START.getTime() + 24 * 60 * 60_000)
    })

    it('unlocks once the window elapses', () => {
      const clock = new FixedClock(START)
      const u = user()
      for (let i = 0; i < 5; i++) u.recordFailedLogin(clock)
      expect(u.canAttemptLogin(clock.now()).isErr()).toBe(true)

      clock.advanceMs(61_000)
      expect(u.isLocked(clock.now())).toBe(false)
      expect(u.canAttemptLogin(clock.now()).isOk()).toBe(true)
    })

    it('clears the counter on a successful login', () => {
      const clock = new FixedClock(START)
      const u = user()
      for (let i = 0; i < 4; i++) u.recordFailedLogin(clock)
      u.recordSuccessfulLogin(clock)
      expect(u.failedLoginCount).toBe(0)
      expect(u.lockedUntil).toBeNull()
      expect(u.lastLoginAt).toEqual(START)
    })
  })

  describe('account state', () => {
    it.each(['suspended', 'deactivated'] as const)('blocks a %s account', (status) => {
      const result = user({ status }).canAttemptLogin(START)
      expect(result.isErr() && result.error.code).toBe('ACCOUNT_DISABLED')
    })

    it('blocks an unaccepted invitation', () => {
      const result = user({ status: 'invited' }).canAttemptLogin(START)
      expect(result.isErr() && result.error.code).toBe('ACCOUNT_NOT_ACTIVATED')
    })

    it('checks account state before lockout, so a suspended account cannot be probed', () => {
      const result = user({
        status: 'suspended',
        lockedUntil: new Date(START.getTime() + 60_000),
      }).canAttemptLogin(START)
      expect(result.isErr() && result.error.code).toBe('ACCOUNT_DISABLED')
    })

    it('activates an invited account exactly once', () => {
      const u = user({ status: 'invited' })
      expect(u.activate().isOk()).toBe(true)
      expect(u.status).toBe('active')
      expect(u.activate().isErr()).toBe(true)
    })
  })

  describe('password change', () => {
    it('rejects reusing the current hash', () => {
      const u = user()
      const result = u.changePassword(u.passwordHash, new FixedClock(START))
      expect(result.isErr() && result.error.code).toBe('PASSWORD_REUSED')
    })

    it('clears lockout and raises an event', () => {
      const clock = new FixedClock(START)
      const u = user({ failedLoginCount: 9, lockedUntil: new Date(START.getTime() + 60_000) })
      expect(u.changePassword('$argon2id$v=19$m=65536,t=3,p=4$new$hash', clock).isOk()).toBe(true)
      expect(u.failedLoginCount).toBe(0)
      expect(u.lockedUntil).toBeNull()

      const events = u.pullEvents()
      expect(events).toHaveLength(1)
      expect(events[0]!.eventType).toBe('identity.password_changed')
    })

    it('drains events only once', () => {
      const u = user()
      u.changePassword('$argon2id$v=19$m=65536,t=3,p=4$x$y', new FixedClock(START))
      expect(u.pullEvents()).toHaveLength(1)
      expect(u.pullEvents()).toHaveLength(0)
    })
  })
})
