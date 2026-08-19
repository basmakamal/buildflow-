import type { Database } from '@buildflow/database'
import type { CompanyId } from '@buildflow/core'
import { PERMISSIONS, SYSTEM_ROLES } from '../domain/permission'

/**
 * Seeds the global permission catalogue and a tenant's default roles.
 *
 * Runs at company provisioning. The roles are seeded as ordinary tenant rows,
 * not as immutable system records, so a contractor who needs "a procurement
 * officer who can also approve stages" edits their own role rather than
 * waiting for a release. That is the whole reason permissions are data.
 * docs/11 §3.2
 *
 * Idempotent: safe to re-run after adding a permission to the catalogue.
 */

const ARABIC_ROLE_NAMES: Readonly<Record<string, string>> = {
  company_owner: 'مالك الشركة',
  project_manager: 'مدير المشروع',
  site_engineer: 'مهندس الموقع',
  interior_designer: 'مصمم داخلي',
  procurement_officer: 'مسؤول المشتريات',
  accountant: 'محاسب',
  client: 'عميل',
}

const ENGLISH_ROLE_NAMES: Readonly<Record<string, string>> = {
  company_owner: 'Company Owner',
  project_manager: 'Project Manager',
  site_engineer: 'Site Engineer',
  interior_designer: 'Interior Designer',
  procurement_officer: 'Procurement Officer',
  accountant: 'Accountant',
  client: 'Client',
}

/**
 * Upserts the global permission catalogue.
 *
 * Permissions are platform-global, not per tenant — every company draws from
 * the same vocabulary, and a tenant-specific permission would be meaningless
 * to the code that checks it.
 */
export async function seedPermissionCatalogue(
  db: Database,
  generateId: () => string,
): Promise<number> {
  let written = 0
  for (const code of PERMISSIONS) {
    const [resource = '', action = ''] = code.split('.')
    const existing = await db.permission.findFirst({ where: { code } })
    if (existing) continue

    await db.permission.create({
      data: {
        id: generateId(),
        code,
        resource,
        action,
        module: moduleFor(resource),
        descriptionEn: `${action.replace(/_/g, ' ')} ${resource}`,
        descriptionAr: `${action.replace(/_/g, ' ')} ${resource}`,
      },
    })
    written++
  }
  return written
}

/** Creates the seven default roles for a newly provisioned company. */
export async function seedCompanyRoles(
  db: Database,
  companyId: CompanyId,
  generateId: () => string,
): Promise<Record<string, string>> {
  const permissionRows = await db.permission.findMany({ select: { id: true, code: true } })
  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]))

  const roleIdByCode: Record<string, string> = {}

  for (const [code, permissions] of Object.entries(SYSTEM_ROLES)) {
    const existing = await db.role.findFirst({ where: { companyId, code } })
    if (existing) {
      roleIdByCode[code] = existing.id
      // Backfill only. A role provisioned before a permission existed would
      // otherwise never receive it, so every tenant created before a release
      // silently lacks that release's capabilities — the docblock's promise of
      // re-run safety was true of the catalogue and false of these links.
      //
      // Links are ADDED, never removed: these roles are tenant-owned and
      // editable, so pruning to match SYSTEM_ROLES would silently revert a
      // customer's deliberate customisation on the next deploy.
      if (existing.isSystem) {
        await grantMissing(db, existing.id, permissions, permissionIdByCode)
      }
      continue
    }

    const roleId = generateId()
    await db.role.create({
      data: {
        id: roleId,
        companyId,
        code,
        nameEn: ENGLISH_ROLE_NAMES[code] ?? code,
        nameAr: ARABIC_ROLE_NAMES[code] ?? code,
        isSystem: true,
        isDefault: code === 'site_engineer',
      },
    })

    const links = permissions
      .map((permission) => permissionIdByCode.get(permission))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId, permissionId }))

    if (links.length > 0) {
      await db.rolePermission.createMany({ data: links })
    }

    roleIdByCode[code] = roleId
  }

  return roleIdByCode
}

/**
 * Adds the role↔permission links a role is missing, leaving existing ones alone.
 */
async function grantMissing(
  db: Database,
  roleId: string,
  permissions: readonly string[],
  permissionIdByCode: ReadonlyMap<string, string>,
): Promise<void> {
  const held = new Set(
    (await db.rolePermission.findMany({ where: { roleId }, select: { permissionId: true } })).map(
      (row) => row.permissionId,
    ),
  )

  const links = permissions
    .map((permission) => permissionIdByCode.get(permission))
    .filter((id): id is string => id !== undefined)
    .filter((id) => !held.has(id))
    .map((permissionId) => ({ roleId, permissionId }))

  if (links.length > 0) await db.rolePermission.createMany({ data: links })
}

function moduleFor(resource: string): string {
  switch (resource) {
    case 'client':
      return 'crm'
    case 'project':
    case 'unit':
      return 'project'
    case 'stage':
      return 'execution'
    case 'boq':
      return 'estimation'
    case 'material':
      return 'catalogue'
    case 'purchase':
    case 'invoice':
    case 'cost':
      return 'procurement'
    case 'document':
      return 'documents'
    case 'report':
      return 'analytics'
    case 'ai':
      return 'ai'
    default:
      return 'platform'
  }
}
