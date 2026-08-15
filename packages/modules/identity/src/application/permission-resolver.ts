import type { CompanyId, UserId } from '@buildflow/core'
import type { Assignment, Principal } from '../domain/authorization'
import { type Permission, isPermission, permissionSetHash } from '../domain/permission'

/**
 * Resolves a user's effective permissions and scope assignments.
 *
 * Called on EVERY authenticated request, so it is cached — but only briefly.
 * The cache TTL is the revocation window: a permission removed from a role
 * takes effect within it. Sixty seconds is the deliberate trade. Longer means
 * a dismissed employee keeps access for longer; shorter means a database
 * round trip on nearly every request. docs/11 §2.2, §3.4
 */

export interface PermissionCache {
  get(key: string): Promise<CachedPrincipal | null>
  set(key: string, value: CachedPrincipal, ttlSeconds: number): Promise<void>
  invalidate(key: string): Promise<void>
}

export interface CachedPrincipal {
  permissions: string[]
  assignments: Assignment[]
  permHash: string
}

export interface PermissionReader {
  /** Permission codes granted by every role the user holds. */
  permissionsFor(userId: UserId): Promise<string[]>
  /** Active (non-revoked) scope assignments. */
  assignmentsFor(userId: UserId): Promise<Assignment[]>
  roleCodesFor(userId: UserId): Promise<string[]>
}

export const PERMISSION_CACHE_TTL_SECONDS = 60

/**
 * In-memory cache.
 *
 * Correct for a single instance; replaced by Redis at Stage 2 when the API runs
 * behind a load balancer, because per-instance caches would otherwise expire at
 * different times and a user could see different permissions per request.
 * The port exists now so that swap is a registration change. docs/17 §3
 */
export class InMemoryPermissionCache implements PermissionCache {
  readonly #store = new Map<string, { value: CachedPrincipal; expiresAt: number }>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  // The port is async because the real implementation is Redis. This one is
  // synchronous, so it resolves immediately rather than declaring `async` and
  // never awaiting anything.
  get(key: string): Promise<CachedPrincipal | null> {
    const entry = this.#store.get(key)
    if (!entry) return Promise.resolve(null)
    if (entry.expiresAt <= this.now()) {
      this.#store.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(entry.value)
  }

  set(key: string, value: CachedPrincipal, ttlSeconds: number): Promise<void> {
    this.#store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 })
    return Promise.resolve()
  }

  invalidate(key: string): Promise<void> {
    this.#store.delete(key)
    return Promise.resolve()
  }
}

export class PermissionResolver {
  constructor(
    private readonly reader: PermissionReader,
    private readonly cache: PermissionCache,
    private readonly ttlSeconds = PERMISSION_CACHE_TTL_SECONDS,
  ) {}

  /**
   * Cache keys are tenant-prefixed.
   *
   * A key collision between tenants would hand one company's permissions to
   * another — the same breach class the data layer prevents, reintroduced
   * through the cache. There is deliberately no key builder without companyId.
   * docs/11 §4
   */
  private key(companyId: CompanyId, userId: UserId): string {
    return `perm:${companyId}:${userId}`
  }

  async resolve(companyId: CompanyId, userId: UserId): Promise<Principal> {
    const cacheKey = this.key(companyId, userId)
    const cached = await this.cache.get(cacheKey)
    if (cached) {
      return {
        userId,
        companyId,
        permissions: new Set(cached.permissions.filter(isPermission)),
        assignments: cached.assignments,
      }
    }

    const [codes, assignments] = await Promise.all([
      this.reader.permissionsFor(userId),
      this.reader.assignmentsFor(userId),
    ])

    // Unknown codes are dropped rather than trusted. A permission removed from
    // the catalogue but still attached to a role must not silently grant
    // anything — failing closed is the only safe direction here.
    const permissions = codes.filter(isPermission)

    await this.cache.set(
      cacheKey,
      { permissions, assignments, permHash: await permissionSetHash(permissions) },
      this.ttlSeconds,
    )

    return { userId, companyId, permissions: new Set<Permission>(permissions), assignments }
  }

  /** Current fingerprint, for embedding in a freshly issued access token. */
  async hashFor(companyId: CompanyId, userId: UserId): Promise<string> {
    const principal = await this.resolve(companyId, userId)
    return permissionSetHash([...principal.permissions])
  }

  /** Called when roles or assignments change, so the next request re-reads. */
  async invalidate(companyId: CompanyId, userId: UserId): Promise<void> {
    await this.cache.invalidate(this.key(companyId, userId))
  }
}
