import { getTenantContext, runWithTenantContext } from './tenant-context'

/**
 * Binds tenant context at CALL time rather than at AWAIT time.
 *
 * THE BUG THIS FIXES (found by the isolation suite, not by review):
 *
 *   runWithTenantContext(ctx, () => db.unit.findMany())
 *
 * Prisma operations are lazy thenables. That callback returns an unresolved
 * PrismaPromise, `storage.run()` returns it, and the AsyncLocalStorage scope
 * exits immediately. The query only executes later, when the caller awaits —
 * by which point the context is gone and the extension throws.
 *
 * It fails safe (throws rather than leaking), but "the developer must remember
 * to await inside the scope" is exactly the class of requirement this
 * architecture exists to eliminate. So instead of documenting a footgun, this
 * proxy captures the context SYNCHRONOUSLY when the model method is called and
 * re-enters it around execution. Both call styles now work identically:
 *
 *   runWithTenantContext(ctx, () => db.unit.findMany())          // ✅
 *   runWithTenantContext(ctx, async () => await db.unit.findMany()) // ✅
 *
 * Cost is one proxy trap and one closure per query — immaterial next to a
 * database round trip.
 */
export function bindTenantContext<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver)

      // Client-level members ($transaction, $connect, $extends, symbols) are
      // passed through untouched — wrapping them would break transaction
      // semantics and Prisma's own internals.
      if (typeof prop === 'symbol' || prop.startsWith('$') || prop.startsWith('_')) {
        return value
      }
      if (typeof value !== 'object' || value === null) return value

      // Model delegates: db.unit, db.project, …
      return new Proxy(value, {
        get(model, operation, modelReceiver) {
          const fn: unknown = Reflect.get(model, operation, modelReceiver)

          if (typeof fn !== 'function') return fn

          return (...args: unknown[]) => {
            // Captured here, while still inside the caller's ALS scope.
            const captured = getTenantContext()

            // No context: let the extension throw with the model and operation
            // named. Swallowing it here would produce a worse error message.
            if (!captured) return (fn as (...a: unknown[]) => unknown).apply(model, args)

            // The await happens INSIDE run(), so the extension executes with
            // the context available.
            return runWithTenantContext(captured, async () =>
              (fn as (...a: unknown[]) => Promise<unknown>).apply(model, args),
            )
          }
        },
      })
    },
  })
}
