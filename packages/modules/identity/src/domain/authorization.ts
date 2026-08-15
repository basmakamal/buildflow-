import type { CompanyId, ProjectId, UnitId, UserId } from '@buildflow/core'
import type { Permission } from './permission'

/**
 * Authorization decisions — pure, no I/O.
 *
 * Three layers, all evaluated server-side on every request. The client's copy
 * is a UX convenience with no security value: it hides what the user cannot do
 * so the interface is honest, while the server enforces it so the interface
 * cannot be lied to. docs/11 §3.1
 *
 *   1. RBAC  — does this principal hold this permission at all?
 *   2. ABAC  — is this principal assigned to THIS project/unit?
 *   3. Field — may this principal see THIS column (cost)?
 */

export type AssignmentScope = 'company' | 'branch' | 'project' | 'unit' | 'client'

export interface Assignment {
  readonly scopeType: AssignmentScope
  readonly scopeId: string
}

export interface Principal {
  readonly userId: UserId
  readonly companyId: CompanyId
  readonly permissions: ReadonlySet<Permission>
  readonly assignments: readonly Assignment[]
}

export interface ResourceScope {
  readonly projectId?: ProjectId | undefined
  readonly unitId?: UnitId | undefined
  readonly clientId?: string | undefined
}

/** Layer 1 — does the principal hold the permission at all? */
export function can(principal: Principal, permission: Permission): boolean {
  return principal.permissions.has(permission)
}

/**
 * Layer 2 — RBAC plus data ownership.
 *
 * The `view` / `view_all` pair is the hinge. A project manager holding
 * `unit.view_all` sees every unit in the company; a site engineer holding only
 * `unit.view` sees the units they are assigned to. Same resource, same action,
 * different reach — expressed as data rather than as a role check.
 */
export function canInScope(
  principal: Principal,
  permission: Permission,
  scope: ResourceScope,
): boolean {
  if (!principal.permissions.has(permission)) return false

  // A company-wide assignment (owner, or an explicitly company-scoped role)
  // satisfies any scope check.
  if (principal.assignments.some((a) => a.scopeType === 'company')) return true

  // `*.view_all` grants company-wide reach for that resource without needing a
  // company assignment.
  const [resource] = permission.split('.')
  if (principal.permissions.has(`${resource}.view_all` as Permission)) return true

  // No scope requested means the caller is asking about the action in general.
  if (!scope.projectId && !scope.unitId && !scope.clientId) return true

  return principal.assignments.some((assignment) => {
    if (assignment.scopeType === 'project' && scope.projectId) {
      return assignment.scopeId === scope.projectId
    }
    if (assignment.scopeType === 'unit' && scope.unitId) {
      return assignment.scopeId === scope.unitId
    }
    if (assignment.scopeType === 'client' && scope.clientId) {
      return assignment.scopeId === scope.clientId
    }
    return false
  })
}

/**
 * Layer 3 — field-level. May this principal see money?
 *
 * Applied at the presenter, and the field is OMITTED rather than masked. An
 * empty space says nothing; `****` announces "there is money information here
 * you are not trusted with", which is worse for morale and still discloses that
 * the data exists. docs/11 §3.3
 */
export function canSeeCost(principal: Principal): boolean {
  return principal.permissions.has('cost.view')
}

export function canSeeMargin(principal: Principal): boolean {
  return principal.permissions.has('cost.view_margin')
}

/**
 * Project ids a principal is assigned to, for query filtering.
 *
 * `null` means "unrestricted" — the caller should apply no project predicate.
 * An empty array means "assigned to nothing", which must produce an empty
 * result set, NOT an unfiltered one. Conflating those two is how a scoping bug
 * turns into a data leak, so they are deliberately different types.
 */
export function assignedProjectIds(principal: Principal, resource: string): string[] | null {
  if (principal.assignments.some((a) => a.scopeType === 'company')) return null
  if (principal.permissions.has(`${resource}.view_all` as Permission)) return null
  return principal.assignments.filter((a) => a.scopeType === 'project').map((a) => a.scopeId)
}
