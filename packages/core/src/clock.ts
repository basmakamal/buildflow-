/**
 * Clock port.
 *
 * The domain layer never reads ambient time — `new Date()` and `Date.now()` are
 * banned there by lint. A stage-delay calculation that reads the system clock
 * cannot be tested without either mocking globals or waiting for real days to
 * pass. Injecting a Clock makes "this stage is 8 days late" a pure function.
 * docs/06 §1
 *
 * All times are UTC. Timezone is a presentation concern resolved from the
 * company's settings. docs/12 §5.3
 */
export interface Clock {
  now(): Date
  /** Epoch milliseconds, for id generation and duration arithmetic. */
  timestamp(): number
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
  timestamp(): number {
    return Date.now()
  }
}

/** Frozen clock for tests. Advance it explicitly to exercise time-dependent rules. */
export class FixedClock implements Clock {
  #current: number

  constructor(start: Date | number = new Date('2026-01-01T00:00:00.000Z')) {
    this.#current = typeof start === 'number' ? start : start.getTime()
  }

  now(): Date {
    return new Date(this.#current)
  }
  timestamp(): number {
    return this.#current
  }

  advanceMs(ms: number): this {
    this.#current += ms
    return this
  }
  advanceDays(days: number): this {
    return this.advanceMs(days * 86_400_000)
  }
  set(at: Date): this {
    this.#current = at.getTime()
    return this
  }
}
