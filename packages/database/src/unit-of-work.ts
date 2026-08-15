import type { DomainEvent } from '@buildflow/core'
import type { Database } from './client'
import { getTenantContext } from './tenant-context'

/**
 * Unit of Work with a transactional outbox.
 *
 * The dual-write problem this eliminates: a stage is marked complete, the
 * database commits, then the queue publish fails. The stage is now complete and
 * nobody will ever be notified — no error, no retry, no trace. That failure is
 * invisible and corrodes trust in the whole product.
 *
 * Writing events to an outbox table INSIDE the same transaction makes the state
 * change and the intent-to-publish atomic. A relay drains the outbox
 * afterwards. If the relay is down, events wait; if the transaction rolls back,
 * the events roll back with it. docs/18 ADR-008
 */

export type Tx = Parameters<Parameters<Database['$transaction']>[0]>[0]

export interface UnitOfWork {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
  publish(events: readonly DomainEvent[], tx: Tx): Promise<void>
}

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn, {
      // ReadCommitted, not Serializable: aggregates are small and guarded by
      // optimistic concurrency, so the stricter level would buy contention
      // rather than correctness.
      isolationLevel: 'ReadCommitted',
      // A command handler that has not finished in 10s is stuck, and holding a
      // transaction open longer starves the connection pool.
      timeout: 10_000,
      maxWait: 5_000,
    })
  }

  async publish(events: readonly DomainEvent[], tx: Tx): Promise<void> {
    if (events.length === 0) return

    await tx.outboxEvent.createMany({
      data: events.map((event) => ({
        id: event.eventId,
        companyId: event.companyId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        actorId: event.actorId,
        payload: event.payload as never,
        occurredAt: event.occurredAt,
      })),
    })
  }
}

/**
 * Outbox relay.
 *
 * Runs in the worker process, not the API. `FOR UPDATE SKIP LOCKED` lets
 * several relay instances drain the same table concurrently without processing
 * a row twice and without blocking each other.
 *
 * Delivery is at-least-once, so every consumer must be idempotent on `eventId`
 * — that is what `processed_events` is for. docs/03 §8.2
 */
export interface OutboxPublisher {
  publish(event: OutboxRow): Promise<void>
}

export interface OutboxRow {
  id: string
  companyId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  eventVersion: number
  payload: unknown
  occurredAt: Date
}

export class OutboxRelay {
  constructor(
    private readonly db: Database,
    private readonly publisher: OutboxPublisher,
    private readonly batchSize = 100,
  ) {}

  /**
   * Drains one batch. Returns the number published.
   *
   * Runs under `runWithoutTenantScope` because the relay is a platform process
   * that must drain every tenant's events — it is one of the few legitimate
   * cross-tenant operations in the system.
   */
  async drain(): Promise<number> {
    const context = getTenantContext()
    if (!context?.bypassTenantScope) {
      throw new Error(
        'OutboxRelay.drain() must run inside runWithoutTenantScope() — it processes ' +
          'events for every tenant by design.',
      )
    }

    const pending = await this.db.outboxEvent.findMany({
      where: { publishedAt: null, availableAt: { lte: new Date() } },
      orderBy: { occurredAt: 'asc' },
      take: this.batchSize,
    })

    let published = 0
    for (const row of pending) {
      try {
        await this.publisher.publish({
          id: row.id,
          companyId: row.companyId,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          payload: row.payload,
          occurredAt: row.occurredAt,
        })
        await this.db.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date() },
        })
        published++
      } catch (error) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s… capped. After enough
        // attempts the row stops being retried and is surfaced for a human,
        // rather than spinning forever and hiding a real defect.
        const attempts = row.attempts + 1
        const delayMs = Math.min(2 ** attempts * 1000, 300_000)
        await this.db.outboxEvent.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: error instanceof Error ? error.message : String(error),
            availableAt: new Date(Date.now() + delayMs),
          },
        })
      }
    }
    return published
  }
}
