import { Prisma, type PrismaClient } from '@prisma/client'
import { MissingTenantContextError } from '@buildflow/core'
import { getCompanyId, isBypassingTenantScope } from './tenant-context'

/**
 * Tenant scoping, enforced at the data layer.
 *
 * THIS IS THE MOST IMPORTANT FILE IN THE CODEBASE.
 *
 * Shared-schema multi-tenancy has exactly one catastrophic failure mode: a
 * developer forgets `WHERE company_id = ?` once. The result is one tenant
 * reading another's clients, costs, and margins — the single bug class that
 * ends a B2B SaaS company.
 *
 * The architecture does not ask developers to remember. This extension
 * intercepts every Prisma operation and injects the tenant predicate itself.
 * There is no code path through the ORM that can omit it, because the injection
 * happens below the point where application code has any say. docs/03 §5.2
 *
 * Three properties make it trustworthy:
 *
 *   1. It THROWS when context is missing, rather than falling through. A
 *      background job that forgot to establish context fails loudly in staging
 *      instead of silently reading every tenant's data in production.
 *   2. Global models are an explicit allow-list, not a default. Adding a model
 *      to it is a visible, reviewable decision.
 *   3. Raw SQL bypasses this entirely, so it is banned outside one audited
 *      directory by a dependency-cruiser rule.
 */

/**
 * Models with no tenant dimension. Reference data, shared by every tenant.
 *
 * ⚠️ Adding a model here removes its tenant protection. It is correct only for
 * data that is genuinely global — never for anything a tenant creates, owns, or
 * would be harmed by another tenant reading.
 */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([
  'Company', // scoped by its own id, not by companyId — see below
  'ProcessedEvent', // consumer bookkeeping, carries no tenant data

  /**
   * The permission catalogue is platform-global: every tenant draws from the
   * same vocabulary, and a tenant-specific permission code would be meaningless
   * to the code that checks it. The table has no companyId column, so it is not
   * scopable even in principle.
   */
  'Permission',

  /**
   * Workflow templates are readable across the tenant boundary BY DESIGN in
   * this slice: the only rows are the system defaults (companyId null), which
   * every tenant instantiates from, and the injected `where companyId = X`
   * would exclude them.
   *
   * ⚠️ REVISIT when tenant-custom templates land: these two must leave this
   * list and reads must become an explicit `OR [{companyId: null}, {companyId:
   * ctx}]` in the repository — otherwise one tenant's custom template would be
   * readable by another. The instantiated per-unit workflow tables are fully
   * tenant-scoped already; only the template CATALOGUE is global today.
   */
  'WorkflowTemplate',
  'WorkflowStageTemplate',

  /**
   * Role↔permission links carry no companyId either. They are reachable only
   * through a Role, which IS tenant-scoped — so the isolation boundary is
   * enforced one join up. Every read in PrismaPermissionReader starts from
   * `userRole`, which is scoped, and traverses inward. Querying this table
   * directly would require already knowing a role's UUID.
   */
  'RolePermission',

  /**
   * The AI knowledge base catalogue: rules shipped and versioned with the
   * product, plus the fact vocabulary they are written against. Neither table
   * has a companyId column, so neither is scopable even in principle — the same
   * situation as Permission above, and for the same reason: a tenant-specific
   * fact code would be meaningless to the engine that evaluates it.
   *
   * This is safe ONLY because tenant customisation lives in a separate table.
   * KbRuleOverride carries a NOT NULL companyId and is deliberately absent from
   * this list, so one tenant's custom rules and disable-flags stay invisible to
   * another. Keep that split — collapsing these into one nullable-companyId
   * table is what the WorkflowTemplate warning above is describing.
   */
  'KbRule',
  'KbFact',
])

/** Operations whose `where` clause needs the tenant predicate added. */
const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
])

/** Operations that write and must be constrained to the tenant. */
const WRITE_WHERE_OPERATIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert'])

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn'])

type AnyArgs = Record<string, unknown>

/**
 * Prisma's `$allOperations` hook is generic over every model and operation, so
 * its parameter is structurally untyped. Declaring the shape explicitly keeps
 * `any` out of the one file where an unchecked value would be most dangerous —
 * a silently-typed `model` or `operation` here is a scoping decision made on a
 * value nobody verified.
 */
interface OperationContext {
  model: string
  operation: string
  args: AnyArgs
  query: (args: AnyArgs) => Promise<unknown>
}

export function withTenantScope(client: PrismaClient) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: OperationContext) {
          if (GLOBAL_MODELS.has(model)) return query(args)

          if (isBypassingTenantScope()) return query(args)

          const companyId = getCompanyId()
          if (!companyId) {
            // Deliberately fatal. The alternative — proceeding unscoped — is a
            // data breach that no test would catch.
            throw new MissingTenantContextError(model, operation)
          }

          return query(injectTenant(operation, args, companyId))
        },
      },
    },
  })
}

function injectTenant(operation: string, args: AnyArgs, companyId: string): AnyArgs {
  const next: AnyArgs = { ...args }

  if (READ_OPERATIONS.has(operation) || WRITE_WHERE_OPERATIONS.has(operation)) {
    // Covers findUnique/update/delete too. Before Prisma 5 those accepted only
    // unique fields in `where` and would have rejected an injected companyId —
    // which would have left `findUnique({ where: { id } })` as a hole straight
    // through the isolation guarantee. Prisma 5 made extended where-unique GA,
    // so a unique field plus additional filters is valid and the predicate
    // applies uniformly to every operation.
    next['where'] = { ...(args['where'] as AnyArgs | undefined), companyId }
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const data = args['data']
    next['data'] = Array.isArray(data)
      ? data.map((row: AnyArgs) => ({ ...row, companyId }))
      : { ...(data as AnyArgs | undefined), companyId }
  }

  if (operation === 'upsert') {
    next['create'] = { ...(args['create'] as AnyArgs | undefined), companyId }
    next['update'] = { ...(args['update'] as AnyArgs | undefined) }
  }

  return next
}

export { Prisma }
