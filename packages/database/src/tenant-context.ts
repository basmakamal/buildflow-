import { AsyncLocalStorage } from 'node:async_hooks'
import type { CompanyId, UserId } from '@buildflow/core'

/**
 * Ambient tenant context, carried through the async call stack.
 *
 * WHY NOT A PARAMETER: threading `companyId` through every function signature
 * means every new call site is an opportunity to forget it, and forgetting it
 * once is a cross-tenant data breach. AsyncLocalStorage makes the tenant
 * ambient and non-negotiable — the data layer reads it directly, so no
 * developer can construct a query that omits it. docs/03 §5.2
 */

export interface RequestContext {
  readonly companyId: CompanyId
  readonly userId: UserId | null
  readonly requestId: string
  readonly source: 'web' | 'mobile' | 'api' | 'system'
  readonly locale: string
  /**
   * Escape hatch for genuinely cross-tenant platform operations: the migration
   * runner, the nightly metering job, Super Admin tooling.
   *
   * Deliberately verbose and deliberately auditable. It must never be set from
   * a request handler — only from a job whose whole purpose is platform-wide,
   * and every use is logged. docs/11 §4
   */
  readonly bypassTenantScope?: true
}

const storage = new AsyncLocalStorage<RequestContext>()

/** Runs `fn` with tenant context bound for the entire async subtree. */
export function runWithTenantContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/** Current context, or undefined outside a bound scope. */
export function getTenantContext(): RequestContext | undefined {
  return storage.getStore()
}

/**
 * Current company, or undefined.
 *
 * Returns undefined rather than throwing so the Prisma extension can decide —
 * it throws with the model and operation named, which is a far more useful
 * error than one raised here without that detail.
 */
export function getCompanyId(): CompanyId | undefined {
  return storage.getStore()?.companyId
}

export function isBypassingTenantScope(): boolean {
  return storage.getStore()?.bypassTenantScope === true
}

/**
 * Runs a platform-wide operation with tenant scoping disabled.
 *
 * The name is intentionally uncomfortable to type and impossible to miss in
 * review. Reach for it only in migrations, metering, and platform admin — never
 * to work around a scoping error, which is always a signal that the context was
 * not established where it should have been.
 */
export function runWithoutTenantScope<T>(
  context: Omit<RequestContext, 'companyId' | 'bypassTenantScope'> & { companyId?: CompanyId },
  fn: () => T,
): T {
  return storage.run(
    {
      ...context,
      companyId: (context.companyId ?? '') as CompanyId,
      bypassTenantScope: true,
    },
    fn,
  )
}
