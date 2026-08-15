import type { Tx } from './unit-of-work'
import { getTenantContext } from './tenant-context'

/**
 * Audit writing, bound to the caller's transaction.
 *
 * WHY IN-TRANSACTION AND NOT ASYNC: an audit write that happens after the
 * commit can fail — the queue is down, the process dies, the network blips —
 * and leaves a change in the database with no record of who made it. For stage
 * approvals, cost overrides, and quantity adjustments that record IS the
 * product: it is what settles a dispute with a client months later. A
 * best-effort audit trail is not an audit trail.
 *
 * So `tx` is a required parameter. There is no overload that writes outside a
 * transaction, because the tempting convenience of one is exactly how audit
 * gaps appear. docs/04 §4, docs/11 §7
 */

export type AuditAction = `${string}.${string}`

export interface AuditEntry {
  action: AuditAction
  entityType: string
  entityId: string
  entityLabel?: string | undefined
  before?: Record<string, unknown> | undefined
  after?: Record<string, unknown> | undefined
  /**
   * Mandatory for destructive or financial changes. The application layer
   * enforces which actions require it — see REASON_REQUIRED_ACTIONS.
   */
  reason?: string | undefined
}

/**
 * Actions that may not be recorded without a stated reason.
 *
 * "Who changed the quantity from 40 to 52" is answerable from before/after.
 * "Why" is not, and it is the question that actually settles an argument.
 */
export const REASON_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  'stage.rejected',
  'stage.hold',
  'project.hold',
  'cost.overridden',
  'boq.line.overridden',
  'material.quantity.adjusted',
  'entity.hard_deleted',
  'permission.changed',
  'invoice.voided',
])

export class AuditWriter {
  constructor(private readonly generateId: () => string) {}

  /**
   * Appends an audit record inside the caller's transaction.
   *
   * Throws if the action requires a reason and none was given. Deliberately
   * loud: a silently unexplained cost override is worse than a failed request,
   * because nobody discovers it until the dispute.
   */
  async write(tx: Tx, entry: AuditEntry): Promise<void> {
    const context = getTenantContext()
    if (!context) {
      throw new Error(
        `Cannot write an audit record for ${entry.action} without tenant context — ` +
          'the actor and company would be unknown, which makes the record useless.',
      )
    }

    if (REASON_REQUIRED_ACTIONS.has(entry.action) && !entry.reason?.trim()) {
      throw new Error(`Action "${entry.action}" requires a reason`)
    }

    const changedFields =
      entry.before && entry.after ? diffKeys(entry.before, entry.after) : undefined

    await tx.auditLog.create({
      data: {
        id: this.generateId(),
        companyId: context.companyId,
        actorUserId: context.userId,
        actorType: context.userId ? 'user' : 'system',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityLabel: entry.entityLabel ?? null,
        before: (entry.before ?? null) as never,
        after: (entry.after ?? null) as never,
        changedFields: (changedFields ?? null) as never,
        reason: entry.reason ?? null,
        requestId: context.requestId,
        source: context.source,
        occurredAt: new Date(),
      },
    })
  }
}

/**
 * Fields that actually changed.
 *
 * Storing only the delta rather than two full snapshots keeps a table that
 * reaches ~400M rows navigable — and makes "what changed" answerable without
 * a human diffing two JSON blobs by eye.
 */
function diffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}
