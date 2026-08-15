import type { Database } from '@buildflow/database'
import type { UserId } from '@buildflow/core'
import type { Assignment } from '../domain/authorization'
import type { PermissionReader } from '../application/permission-resolver'

/**
 * Reads effective permissions and scope assignments from the database.
 *
 * Both queries run tenant-scoped, so a user in another company resolves to no
 * permissions rather than to someone else's — the failure mode is "denied",
 * never "granted the wrong thing".
 */
export class PrismaPermissionReader implements PermissionReader {
  constructor(private readonly db: Database) {}

  async permissionsFor(userId: UserId): Promise<string[]> {
    const rows = await this.db.userRole.findMany({
      where: { userId },
      select: {
        role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
      },
    })

    // Flattened and de-duplicated: a user holding two roles that share a
    // permission must not produce a different hash from one that holds it once.
    return [...new Set(rows.flatMap((row) => row.role.permissions.map((rp) => rp.permission.code)))]
  }

  async assignmentsFor(userId: UserId): Promise<Assignment[]> {
    const rows = await this.db.userAssignment.findMany({
      // revokedAt: null is the whole point — a revoked assignment must stop
      // granting scope immediately, not merely stop being displayed.
      where: { userId, revokedAt: null },
      select: { scopeType: true, scopeId: true },
    })
    return rows.map((row) => ({ scopeType: row.scopeType, scopeId: row.scopeId }))
  }

  async roleCodesFor(userId: UserId): Promise<string[]> {
    const rows = await this.db.userRole.findMany({
      where: { userId },
      select: { role: { select: { code: true } } },
    })
    return rows.map((row) => row.role.code)
  }
}
