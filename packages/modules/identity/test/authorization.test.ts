import { describe, it, expect } from 'vitest'
import type { CompanyId, ProjectId, UnitId, UserId } from '@buildflow/core'
import {
  can,
  canInScope,
  canSeeCost,
  canSeeMargin,
  assignedProjectIds,
  type Principal,
} from '../src/domain/authorization'
import { SYSTEM_ROLES, permissionSetHash, type Permission } from '../src/domain/permission'

const PROJECT_A = 'prj-a' as ProjectId
const PROJECT_B = 'prj-b' as ProjectId

const principal = (
  role: keyof typeof SYSTEM_ROLES,
  assignments: Principal['assignments'] = [],
): Principal => ({
  userId: 'usr-1' as UserId,
  companyId: 'co-1' as CompanyId,
  permissions: new Set((SYSTEM_ROLES[role] ?? []) as readonly Permission[]),
  assignments,
})

describe('RBAC', () => {
  it('grants a held permission', () => {
    expect(can(principal('site_engineer'), 'stage.update_progress')).toBe(true)
  })

  it('denies a permission not held', () => {
    expect(can(principal('site_engineer'), 'stage.approve')).toBe(false)
  })

  it('gives the company owner everything', () => {
    const owner = principal('company_owner')
    expect(can(owner, 'company.manage_billing')).toBe(true)
    expect(can(owner, 'invoice.void')).toBe(true)
  })
})

describe('field-level cost visibility', () => {
  /**
   * The most requested control from contractors in this market: crews should
   * not learn the company's margin from a phone screen. docs/11 §3.3
   */
  it('hides cost from a site engineer', () => {
    expect(canSeeCost(principal('site_engineer'))).toBe(false)
    expect(canSeeMargin(principal('site_engineer'))).toBe(false)
  })

  it('shows quantities to a site engineer even though prices are hidden', () => {
    const engineer = principal('site_engineer')
    expect(can(engineer, 'material.view')).toBe(true)
    expect(can(engineer, 'boq.view')).toBe(true)
    expect(canSeeCost(engineer)).toBe(false)
  })

  it('shows cost but not margin to procurement', () => {
    expect(canSeeCost(principal('procurement_officer'))).toBe(true)
    expect(canSeeMargin(principal('procurement_officer'))).toBe(false)
  })

  it('shows both to the accountant', () => {
    expect(canSeeCost(principal('accountant'))).toBe(true)
    expect(canSeeMargin(principal('accountant'))).toBe(true)
  })
})

describe('ABAC scoping', () => {
  it('allows an engineer to act on an assigned project', () => {
    const engineer = principal('site_engineer', [{ scopeType: 'project', scopeId: PROJECT_A }])
    expect(canInScope(engineer, 'stage.update_progress', { projectId: PROJECT_A })).toBe(true)
  })

  it('denies an engineer on a project they are not assigned to', () => {
    // The permission is held; the assignment is not. This is the distinction
    // that stops one engineer seeing every site in the company.
    const engineer = principal('site_engineer', [{ scopeType: 'project', scopeId: PROJECT_A }])
    expect(canInScope(engineer, 'stage.update_progress', { projectId: PROJECT_B })).toBe(false)
  })

  it('lets view_all reach across the whole company', () => {
    // A project manager holds project.view_all, so no per-project assignment
    // is needed — same permission, wider reach, expressed as data.
    const pm = principal('project_manager')
    expect(canInScope(pm, 'project.view', { projectId: PROJECT_B })).toBe(true)
  })

  it('honours a company-wide assignment', () => {
    const owner = principal('company_owner', [{ scopeType: 'company', scopeId: 'co-1' }])
    expect(canInScope(owner, 'unit.update', { unitId: 'unit-x' as UnitId })).toBe(true)
  })

  it('still denies when the permission itself is missing, however broad the assignment', () => {
    const engineer = principal('site_engineer', [{ scopeType: 'company', scopeId: 'co-1' }])
    expect(canInScope(engineer, 'stage.approve', { projectId: PROJECT_A })).toBe(false)
  })

  it('scopes a client to their own units', () => {
    const client = principal('client', [{ scopeType: 'unit', scopeId: 'unit-305' }])
    expect(canInScope(client, 'unit.view', { unitId: 'unit-305' as UnitId })).toBe(true)
    expect(canInScope(client, 'unit.view', { unitId: 'unit-999' as UnitId })).toBe(false)
  })
})

describe('assignedProjectIds', () => {
  it('returns null (unrestricted) for view_all', () => {
    expect(assignedProjectIds(principal('project_manager'), 'project')).toBeNull()
  })

  it('returns the assigned ids for a scoped principal', () => {
    const engineer = principal('site_engineer', [
      { scopeType: 'project', scopeId: PROJECT_A },
      { scopeType: 'project', scopeId: PROJECT_B },
    ])
    expect(assignedProjectIds(engineer, 'project')).toEqual([PROJECT_A, PROJECT_B])
  })

  it('returns an empty array — NOT null — when assigned to nothing', () => {
    // The distinction that matters: null means "apply no filter", [] means
    // "match nothing". Conflating them turns a scoping bug into a data leak,
    // so they are deliberately different values.
    expect(assignedProjectIds(principal('site_engineer'), 'project')).toEqual([])
  })
})

describe('permissionSetHash', () => {
  it('is stable regardless of ordering', async () => {
    // Databases return rows in arbitrary order; the hash must not depend on it,
    // or every request would appear to have different permissions.
    const a = await permissionSetHash(['unit.view', 'cost.view', 'stage.approve'])
    const b = await permissionSetHash(['stage.approve', 'unit.view', 'cost.view'])
    expect(a).toBe(b)
  })

  it('ignores duplicates', async () => {
    expect(await permissionSetHash(['unit.view', 'unit.view'])).toBe(
      await permissionSetHash(['unit.view']),
    )
  })

  it('changes when a permission is revoked', async () => {
    // This is what makes revocation detectable within the cache window rather
    // than at token expiry. docs/11 §2.2
    const before = await permissionSetHash(['unit.view', 'cost.view'])
    const after = await permissionSetHash(['unit.view'])
    expect(after).not.toBe(before)
  })

  it('is short enough to keep the token small', async () => {
    expect(await permissionSetHash(SYSTEM_ROLES['company_owner'] ?? [])).toHaveLength(16)
  })
})

describe('system role definitions', () => {
  it('defines all eight roles from the PRD', () => {
    expect(Object.keys(SYSTEM_ROLES)).toHaveLength(7) // super_admin is platform-level, not tenant
    expect(SYSTEM_ROLES).toHaveProperty('site_engineer')
    expect(SYSTEM_ROLES).toHaveProperty('client')
  })

  it('never grants a client access to another tenant surface', () => {
    const client = principal('client')
    expect(can(client, 'client.view_all')).toBe(false)
    expect(can(client, 'cost.view')).toBe(false)
    expect(can(client, 'user.view')).toBe(false)
  })
})
