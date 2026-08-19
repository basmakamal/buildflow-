import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator } from '@buildflow/core'
import { withTenantScope, bindTenantContext, runWithoutTenantScope } from '@buildflow/database'
import { seedCompanyRoles, seedPermissionCatalogue } from '@buildflow/identity'

/**
 * Re-seeding must reach tenants that already exist.
 *
 * A role is created once, at provisioning. Every permission added to the
 * catalogue afterwards therefore reaches NEW tenants automatically and OLD ones
 * not at all — so a customer onboarded last year silently lacks this year's
 * capabilities, and the only symptom is a 403 nobody can explain.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

beforeAll(async () => {
  await raw.$connect()
})
afterAll(async () => {
  await raw.$disconnect()
})

describe('seedCompanyRoles', () => {
  it('backfills a permission granted after the role was provisioned', async () => {
    const companyId = ids.next<'CompanyId'>()

    await runWithoutTenantScope(sys, async () => {
      await raw.company.create({
        data: {
          id: companyId,
          nameEn: 'Backfill',
          nameAr: 'إعادة',
          slug: `backfill-${String(Date.now())}`,
          countryCode: 'SA',
          defaultCurrency: 'SAR',
        },
      })
    })

    await seedPermissionCatalogue(db, () => ids.next())
    const roleIds = await runWithoutTenantScope(sys, () =>
      seedCompanyRoles(db, companyId, () => ids.next()),
    )
    const ownerRoleId = roleIds['company_owner']!

    const linkCount = () =>
      runWithoutTenantScope(sys, () => raw.rolePermission.count({ where: { roleId: ownerRoleId } }))

    const before = await linkCount()
    expect(before).toBeGreaterThan(0)

    // Stand in for "this permission did not exist when the tenant was created".
    const dropped = await runWithoutTenantScope(sys, () =>
      raw.rolePermission.findFirst({ where: { roleId: ownerRoleId } }),
    )
    await runWithoutTenantScope(sys, () =>
      raw.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: dropped!.roleId,
            permissionId: dropped!.permissionId,
          },
        },
      }),
    )
    expect(await linkCount()).toBe(before - 1)

    await runWithoutTenantScope(sys, () => seedCompanyRoles(db, companyId, () => ids.next()))

    expect(await linkCount()).toBe(before)

    // Re-running again must not duplicate what it just restored.
    await runWithoutTenantScope(sys, () => seedCompanyRoles(db, companyId, () => ids.next()))
    expect(await linkCount()).toBe(before)

    await runWithoutTenantScope(sys, async () => {
      await raw.rolePermission.deleteMany({ where: { role: { companyId } } })
      await raw.role.deleteMany({ where: { companyId } })
      await raw.company.delete({ where: { id: companyId } })
    })
  })
})
