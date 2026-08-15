import { PrismaClient } from '@prisma/client'
import { withTenantScope } from './tenant-extension'
import { bindTenantContext } from './bind-context'

/**
 * Prisma client factory.
 *
 * Application code never constructs a raw PrismaClient — it resolves this one
 * from the DI container, and this one is always tenant-scoped. That is the
 * whole point: there is no unscoped client available to reach for.
 */

export type Database = ReturnType<typeof createDatabase>

export interface DatabaseOptions {
  url: string
  /** Logs every query with its duration. Development only — queries can carry PII. */
  logQueries?: boolean
  slowQueryMs?: number
}

export function createDatabase(options: DatabaseOptions) {
  const base = new PrismaClient({
    datasources: { db: { url: options.url } },
    log: options.logQueries
      ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
      : ['warn', 'error'],
  })

  if (options.logQueries) {
    const threshold = options.slowQueryMs ?? 200
    base.$on('query', (event: { duration: number; query: string }) => {
      if (event.duration >= threshold) {
        console.warn(`[db] slow query ${event.duration}ms: ${event.query.slice(0, 300)}`)
      }
    })
  }

  // Order matters: scope first (inject the predicate), then bind (make the
  // context reachable at execution time regardless of how the caller awaits).
  return bindTenantContext(withTenantScope(base))
}

/**
 * Per-tenant connection resolution.
 *
 * Unused in Phase 0 — every tenant shares one database. It exists now so that
 * moving an Enterprise tenant to a dedicated database later is a registry
 * change rather than a refactor of every call site: application code only ever
 * asks the registry for a client, and never knows which mode it is in.
 * docs/03 §5.4, docs/17 §5.4
 */
export class TenantConnectionRegistry {
  readonly #dedicated = new Map<string, Database>()

  constructor(
    private readonly shared: Database,
    private readonly resolveDedicatedUrl?: (companyId: string) => string | undefined,
  ) {}

  get(companyId: string): Database {
    const cached = this.#dedicated.get(companyId)
    if (cached) return cached

    const url = this.resolveDedicatedUrl?.(companyId)
    if (!url) return this.shared

    const client = createDatabase({ url })
    this.#dedicated.set(companyId, client)
    return client
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.#dedicated.values()].map((c) => c.$disconnect()))
    await this.shared.$disconnect()
  }
}
