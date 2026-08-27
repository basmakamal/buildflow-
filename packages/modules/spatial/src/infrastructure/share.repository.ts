import type { Database } from '@buildflow/database'
import type { PlanShare } from '../domain/share'

/**
 * Share-link persistence. docs/04 §2.5
 *
 * `findByHash` is the one query in this module that runs WITHOUT a tenant in
 * context: the caller is an anonymous visitor holding a link, so there is no
 * company to scope by. That is why the token hash is unique across the table
 * and why the row carries `companyId` — the lookup establishes the tenant
 * rather than assuming it.
 */

export interface ShareRepository {
  create(share: PlanShare, companyId: string): Promise<void>
  listForPlan(floorPlanId: string): Promise<PlanShare[]>
  findById(id: string): Promise<PlanShare | null>
  /** Unscoped by design — see the note above. Returns the tenant it belongs to. */
  findByHash(tokenHash: string): Promise<{ share: PlanShare; companyId: string } | null>
  revoke(id: string, at: Date): Promise<void>
  countView(id: string): Promise<void>
}

interface ShareRow {
  id: string
  floorPlanId: string
  tokenHash: string
  label: string
  expiresAt: Date
  viewCount: number
  createdBy: string
  createdAt: Date
  revokedAt: Date | null
}

const toDomain = (row: ShareRow): PlanShare => ({
  id: row.id,
  floorPlanId: row.floorPlanId,
  tokenHash: row.tokenHash,
  label: row.label,
  expiresAt: row.expiresAt,
  viewCount: row.viewCount,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
})

export class PrismaShareRepository implements ShareRepository {
  constructor(private readonly db: Database) {}

  async create(share: PlanShare, companyId: string): Promise<void> {
    await this.db.planShare.create({
      data: {
        id: share.id,
        companyId,
        floorPlanId: share.floorPlanId,
        tokenHash: share.tokenHash,
        label: share.label,
        expiresAt: share.expiresAt,
        viewCount: share.viewCount,
        createdBy: share.createdBy,
        createdAt: share.createdAt,
        revokedAt: share.revokedAt,
      },
    })
  }

  async listForPlan(floorPlanId: string): Promise<PlanShare[]> {
    const rows = await this.db.planShare.findMany({
      where: { floorPlanId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toDomain)
  }

  async findById(id: string): Promise<PlanShare | null> {
    const row = await this.db.planShare.findFirst({ where: { id } })
    return row ? toDomain(row) : null
  }

  async findByHash(tokenHash: string): Promise<{ share: PlanShare; companyId: string } | null> {
    const row = await this.db.planShare.findFirst({ where: { tokenHash } })
    return row ? { share: toDomain(row), companyId: row.companyId } : null
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.db.planShare.updateMany({ where: { id }, data: { revokedAt: at } })
  }

  /**
   * Counts a visit with an atomic increment rather than a read-then-write: a
   * link forwarded to a family group is opened by six people at once, and a
   * lost-update race would undercount exactly when the number is interesting.
   */
  async countView(id: string): Promise<void> {
    await this.db.planShare.updateMany({ where: { id }, data: { viewCount: { increment: 1 } } })
  }
}
