/**
 * Explicit success/failure, instead of exceptions for expected outcomes.
 *
 * Domain failures — invalid stage transition, insufficient stock, quota
 * exceeded — are ordinary outcomes, not bugs. Modelling them as exceptions
 * hides them from the type system, so a caller can forget one and find out in
 * production. A `Result` in the signature makes every failure path visible and
 * unignorable. docs/06 §3.3
 *
 * Exceptions remain correct for genuine bugs and infrastructure faults: a lost
 * database connection is not something a command handler should branch on.
 */

export type Result<T, E> = Ok<T, E> | Err<T, E>

class Ok<T, E> {
  readonly _tag = 'ok' as const
  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true
  }
  isErr(): this is Err<T, E> {
    return false
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value))
  }
  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return this as unknown as Result<T, F>
  }
  andThen<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value)
  }
  unwrapOr(_fallback: T): T {
    return this.value
  }

  /** Throws on Err. Use only in tests and at a composition root. */
  unwrap(): T {
    return this.value
  }
}

class Err<T, E> {
  readonly _tag = 'err' as const
  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false
  }
  isErr(): this is Err<T, E> {
    return true
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return this as unknown as Result<U, E>
  }
  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error))
  }
  andThen<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return this as unknown as Result<U, E>
  }
  unwrapOr(fallback: T): T {
    return fallback
  }

  unwrap(): T {
    throw new Error(`Called unwrap() on an Err: ${JSON.stringify(this.error)}`)
  }
}

export const ok: {
  (): Result<void, never>
  <T>(value: T): Result<T, never>
} = (<T>(value?: T) => new Ok(value as T)) as never

export const err = <E>(error: E): Result<never, E> => new Err(error)

/**
 * Collects a list of Results into a Result of a list, failing on the first Err.
 * Used when validating a batch — e.g. a mobile client syncing 40 offline
 * mutations, where the first structural failure should stop the batch.
 */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (r.isErr()) return err(r.error)
    values.push(r.value)
  }
  return ok(values)
}
