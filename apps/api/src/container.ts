import { SystemClock, Uuid7Generator, type Clock, type IdGenerator } from '@buildflow/core'
import type { Database } from '@buildflow/database'
import {
  Argon2PasswordHasher,
  JwtTokenIssuer,
  LoginHandler,
  PrismaLoginAttemptRecorder,
  PrismaRefreshTokenRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
  RefreshHandler,
  type RefreshTokenRepository,
  type SessionRepository,
  type SecurityAlerter,
} from '@buildflow/identity'

/**
 * Composition root.
 *
 * Wired by hand rather than with a DI container. docs/06 §7 specifies Awilix,
 * and that remains right once there are dozens of registrations with scoped
 * lifetimes — but for eight objects a container adds indirection without
 * removing any. This is a deliberate, revisitable deviation, not an oversight:
 * swap it when the graph justifies it, and nothing outside this file changes,
 * because every consumer already depends on interfaces rather than on
 * construction.
 */
export interface Container {
  login: LoginHandler
  refresh: RefreshHandler
  refreshTokens: RefreshTokenRepository
  sessions: SessionRepository
  clock: Clock
  ids: IdGenerator
}

export interface ContainerOptions {
  db: Database
  jwtSecret: string
  clock?: Clock
  ids?: IdGenerator
  alerter?: SecurityAlerter
}

export function createContainer(options: ContainerOptions): Container {
  const clock = options.clock ?? new SystemClock()
  const ids = options.ids ?? new Uuid7Generator()

  const users = new PrismaUserRepository(options.db)
  const sessions = new PrismaSessionRepository(options.db)
  const refreshTokens = new PrismaRefreshTokenRepository(options.db)
  const attempts = new PrismaLoginAttemptRecorder(options.db, () => ids.next())

  const hasher = new Argon2PasswordHasher()
  const tokens = new JwtTokenIssuer(options.jwtSecret)

  const alerter: SecurityAlerter = options.alerter ?? {
    // Placeholder until Notifications lands. Logged loudly because a detected
    // stolen token is exactly the event that must never pass silently.
    refreshTokenReuseDetected: (input) => {
      console.error('[SECURITY] refresh token reuse detected', input)
      return Promise.resolve()
    },
  }

  return {
    login: new LoginHandler(users, sessions, refreshTokens, hasher, tokens, attempts, clock, ids),
    refresh: new RefreshHandler(refreshTokens, sessions, users, tokens, alerter, clock, ids),
    refreshTokens,
    sessions,
    clock,
    ids,
  }
}
