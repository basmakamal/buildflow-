/**
 * Permission catalogue and effective permission sets.
 *
 * Permissions are `resource.action` strings, and roles are compositions of
 * them — never hard-coded role checks. `if (user.role === 'admin')` scattered
 * through the codebase is why permission models ossify: every new customer
 * requirement means finding and editing every such check. A catalogue plus
 * tenant-definable roles means a customer who wants "a procurement officer who
 * can also approve stages" configures it instead of filing a feature request.
 * docs/11 §3
 */

export const PERMISSIONS = [
  // CRM
  'client.view',
  'client.view_all',
  'client.create',
  'client.update',
  'client.delete',
  'client.export',
  // Projects
  'project.view',
  'project.view_all',
  'project.create',
  'project.update',
  'project.delete',
  'project.change_status',
  'project.manage_team',
  // Units
  'unit.view',
  'unit.view_all',
  'unit.create',
  'unit.update',
  'unit.delete',
  'unit.clone',
  'unit.deliver',
  // Execution
  'stage.view',
  'stage.update_progress',
  'stage.complete',
  'stage.approve',
  'stage.reject',
  'stage.assign',
  // Estimation
  'boq.view',
  'boq.generate',
  'boq.update',
  'boq.override_line',
  'boq.approve',
  'boq.export',
  // Catalogue & materials
  'material.view',
  'material.create',
  'material.update',
  'material.record_consumption',
  'material.adjust_stock',
  // Procurement
  'purchase.view',
  'purchase.create',
  'purchase.approve',
  'purchase.receive',
  'invoice.view',
  'invoice.create',
  'invoice.update',
  'invoice.allocate',
  'invoice.record_payment',
  'invoice.void',
  // Money — the field-level dimension
  'cost.view',
  'cost.view_margin',
  'cost.update_budget',
  // Documents
  'document.view',
  'document.upload',
  'document.download',
  'document.delete',
  'document.share_external',
  // Reporting
  'report.view',
  'report.run',
  'report.export',
  'report.schedule',
  // Administration
  'user.view',
  'user.invite',
  'user.update',
  'user.deactivate',
  'user.manage_roles',
  'company.view_settings',
  'company.update_settings',
  'company.manage_billing',
  'ai.use',
  'ai.view_usage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

export const isPermission = (value: string): value is Permission => PERMISSION_SET.has(value)

/**
 * Permissions requiring a second reviewer when granted, and a reason when used.
 * These are the ones that move money or destroy data.
 */
export const DANGEROUS_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'client.delete',
  'project.delete',
  'unit.delete',
  'invoice.void',
  'boq.override_line',
  'material.adjust_stock',
  'user.manage_roles',
  'company.manage_billing',
])

/**
 * Default role definitions, seeded per tenant and fully overridable.
 *
 * The distinction that carries the most weight: `view` means "records I am
 * assigned to", `view_all` means "every record in the company". That single
 * pair is what separates a site engineer from a project manager without
 * duplicating every permission. docs/11 §3.2
 */
export const SYSTEM_ROLES: Readonly<Record<string, readonly Permission[]>> = {
  company_owner: [...PERMISSIONS],

  project_manager: [
    'client.view',
    'client.create',
    'client.update',
    'project.view',
    'project.view_all',
    'project.create',
    'project.update',
    'project.change_status',
    'project.manage_team',
    'unit.view',
    'unit.view_all',
    'unit.create',
    'unit.update',
    'unit.clone',
    'unit.deliver',
    'stage.view',
    'stage.update_progress',
    'stage.complete',
    'stage.approve',
    'stage.reject',
    'stage.assign',
    'boq.view',
    'boq.generate',
    'boq.update',
    'boq.approve',
    'boq.export',
    'material.view',
    'material.record_consumption',
    'purchase.view',
    'purchase.create',
    'invoice.view',
    'cost.view',
    'cost.view_margin',
    'document.view',
    'document.upload',
    'document.download',
    'report.view',
    'report.run',
    'report.export',
    'ai.use',
  ],

  /**
   * Site engineer: quantities but NOT prices.
   *
   * `cost.view` is deliberately absent. Crews should not learn the company's
   * margin from a phone screen, and this is the single most requested control
   * from contractors in this market. Enforced at the presenter, not by hiding
   * a button. docs/11 §3.3
   */
  site_engineer: [
    'project.view',
    'unit.view',
    'stage.view',
    'stage.update_progress',
    'stage.complete',
    'boq.view',
    'material.view',
    'material.record_consumption',
    'document.view',
    'document.upload',
    'document.download',
    'invoice.create',
  ],

  interior_designer: [
    'client.view',
    'project.view',
    'unit.view',
    'unit.update',
    'stage.view',
    'boq.view',
    'boq.generate',
    'boq.update',
    'material.view',
    'document.view',
    'document.upload',
    'document.download',
    'ai.use',
  ],

  procurement_officer: [
    'project.view',
    'project.view_all',
    'unit.view',
    'unit.view_all',
    'stage.view',
    'boq.view',
    'material.view',
    'material.create',
    'material.update',
    'material.adjust_stock',
    'purchase.view',
    'purchase.create',
    'purchase.approve',
    'purchase.receive',
    'invoice.view',
    'invoice.create',
    'invoice.update',
    'invoice.allocate',
    'cost.view',
    'document.view',
    'document.upload',
    'document.download',
    'report.view',
    'report.run',
  ],

  accountant: [
    'client.view',
    'client.view_all',
    'project.view',
    'project.view_all',
    'unit.view',
    'unit.view_all',
    'boq.view',
    'invoice.view',
    'invoice.create',
    'invoice.update',
    'invoice.allocate',
    'invoice.record_payment',
    'invoice.void',
    'cost.view',
    'cost.view_margin',
    'cost.update_budget',
    'document.view',
    'document.download',
    'report.view',
    'report.run',
    'report.export',
  ],

  /**
   * Client portal. Scoped to their OWN units by ABAC on top of these — the
   * permission alone grants nothing without an assignment. docs/11 §3.1
   */
  client: ['project.view', 'unit.view', 'stage.view', 'document.view', 'document.download'],
}

/**
 * Stable fingerprint of an effective permission set.
 *
 * Goes in the access token INSTEAD of the permissions themselves. A token
 * carrying the full set stays valid until it expires, so revoking access would
 * take up to 15 minutes; with a hash, permissions are resolved server-side from
 * a short-lived cache and revocation lands within that window. It also keeps
 * the token small — an owner has 60+ permissions. docs/11 §2.2
 *
 * Sorted before hashing so set equality produces hash equality regardless of
 * the order the database returned rows in.
 */
export async function permissionSetHash(permissions: readonly string[]): Promise<string> {
  const canonical = [...new Set(permissions)].sort().join(',')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
