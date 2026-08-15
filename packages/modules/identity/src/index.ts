/**
 * Identity — PUBLIC CONTRACT.
 *
 * The only legal import surface for this module. Aggregates, repositories, and
 * infrastructure stay internal; other modules depend on these types and on the
 * events published to the outbox. Enforced by the `no-deep-module-imports` rule
 * in .dependency-cruiser.cjs. docs/03 §6.1
 */
export { LoginHandler, type LoginCommand, type AuthTokens } from './application/login.handler'
export {
  RefreshHandler,
  type RefreshCommand,
  type SecurityAlerter,
} from './application/refresh.handler'

export type {
  UserRepository,
  SessionRepository,
  RefreshTokenRepository,
  PasswordHasher,
  TokenIssuer,
  AccessTokenClaims,
  LoginAttemptRecorder,
  NewSession,
  NewRefreshToken,
} from './domain/ports'

export { User, type UserSnapshot, type UserStatus } from './domain/user'
export {
  evaluateRefresh,
  generateRefreshToken,
  hashToken,
  type RefreshTokenRecord,
  type RotationOutcome,
} from './domain/refresh-token-family'

export { Argon2PasswordHasher } from './infrastructure/argon2-hasher'
export { JwtTokenIssuer } from './infrastructure/jwt-token-issuer'

export {
  PERMISSIONS,
  SYSTEM_ROLES,
  DANGEROUS_PERMISSIONS,
  isPermission,
  permissionSetHash,
  type Permission,
} from './domain/permission'
export {
  can,
  canInScope,
  canSeeCost,
  canSeeMargin,
  assignedProjectIds,
  type Principal,
  type Assignment,
  type ResourceScope,
} from './domain/authorization'
export {
  PrismaUserRepository,
  PrismaSessionRepository,
  PrismaRefreshTokenRepository,
  PrismaLoginAttemptRecorder,
} from './infrastructure/prisma.repositories'
