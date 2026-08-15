import type { Branded, CompanyId, EventId, UserId } from './ids'

/**
 * Tactical DDD base types.
 *
 * The rule these encode: aggregates RAISE events, they never DISPATCH them.
 * Dispatch happens in the Unit of Work after a successful commit. An aggregate
 * that published directly would announce a change that might still roll back —
 * notifying a project manager that a stage was approved when the transaction
 * failed. docs/06 §3.1
 */

export interface DomainEvent<TPayload = unknown> {
  readonly eventId: EventId
  readonly eventType: string
  readonly occurredAt: Date
  readonly companyId: CompanyId
  readonly actorId: UserId | null
  readonly aggregateType: string
  readonly aggregateId: string
  /** Schema version of the payload, so consumers can evolve independently. */
  readonly eventVersion: number
  readonly payload: TPayload
}

export abstract class ValueObject<T extends Record<string, unknown>> {
  protected constructor(readonly props: Readonly<T>) {
    Object.freeze(this.props)
  }

  /** Value objects are compared by value, never by reference. */
  equals(other?: ValueObject<T>): boolean {
    if (!other) return false
    return JSON.stringify(this.props) === JSON.stringify(other.props)
  }
}

export abstract class Entity<TId extends Branded<string, string>> {
  protected constructor(readonly id: TId) {}

  /** Entities are compared by identity, never by attributes. */
  equals(other?: Entity<TId>): boolean {
    return !!other && this.id === other.id
  }
}

export abstract class AggregateRoot<TId extends Branded<string, string>> extends Entity<TId> {
  #events: DomainEvent[] = []
  #version: number

  protected constructor(id: TId, version = 0) {
    super(id)
    this.#version = version
  }

  /**
   * Optimistic concurrency token.
   *
   * Every aggregate carries one because concurrent writes are routine here, not
   * exceptional: a site engineer updates a stage offline while the project
   * manager approves it from the web. Last-write-wins would silently discard
   * one of them. docs/02 §5
   */
  get version(): number {
    return this.#version
  }

  protected raise(event: DomainEvent): void {
    this.#events.push(event)
  }

  /**
   * Drains pending events. Called only by the Unit of Work, inside the same
   * transaction as the state change, writing them to the outbox.
   */
  pullEvents(): DomainEvent[] {
    const events = this.#events
    this.#events = []
    return events
  }

  get hasUncommittedEvents(): boolean {
    return this.#events.length > 0
  }
}
