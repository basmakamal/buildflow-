import { Uuid7Generator } from '@buildflow/core'
import { createDatabase, runWithoutTenantScope } from '@buildflow/database'
import {
  Argon2PasswordHasher,
  seedCompanyRoles,
  seedPermissionCatalogue,
} from '@buildflow/identity'
import { seedDefaultTemplate } from '@buildflow/execution'

/**
 * Development seed — a demo tenant you can log into.
 *
 * DEV ONLY, guarded against production: it creates users with a printed
 * password. Idempotent by company slug, so re-running changes nothing.
 *
 * Run: pnpm --filter @buildflow/api seed
 */
if (process.env['NODE_ENV'] === 'production') {
  throw new Error('dev-seed must never run in production')
}

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const PASSWORD = 'demo-passphrase-for-local-development'
const ids = new Uuid7Generator()
const db = createDatabase({ url: DATABASE_URL })
const sys = { userId: null, requestId: 'dev-seed', source: 'system' as const, locale: 'en' }

async function main(): Promise<void> {
  await seedPermissionCatalogue(db, () => ids.next())
  await runWithoutTenantScope(sys, () => seedDefaultTemplate(db, () => ids.next()))

  const existing = await runWithoutTenantScope(sys, () =>
    db.company.findFirst({ where: { slug: 'demo' } }),
  )
  if (existing) {
    console.warn(`demo tenant exists — companyId ${existing.id}`)
    console.warn(`login: owner@demo.sa / ${PASSWORD}`)
    return
  }

  const companyId = ids.next()
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)

  await runWithoutTenantScope(sys, async () => {
    await db.company.create({
      data: {
        id: companyId,
        nameEn: 'Demo Finishing Co.',
        nameAr: 'شركة التشطيبات التجريبية',
        slug: 'demo',
        countryCode: 'SA',
        defaultCurrency: 'SAR',
        status: 'active',
      },
    })
  })

  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, companyId as never, () => ids.next()),
  )

  const users: [string, string][] = [
    ['owner@demo.sa', 'company_owner'],
    ['manager@demo.sa', 'project_manager'],
    ['engineer@demo.sa', 'site_engineer'],
  ]

  const seededUsers: { userId: string; role: string }[] = []

  await runWithoutTenantScope(sys, async () => {
    for (const [email, role] of users) {
      const userId = ids.next()
      await db.user.create({
        data: {
          id: userId,
          companyId,
          email,
          passwordHash: hash,
          firstNameEn: role.split('_')[0] ?? 'Demo',
          lastNameEn: 'Demo',
          firstNameAr: 'تجريبي',
          lastNameAr: 'مستخدم',
          status: 'active',
        },
      })
      const roleId = roleIds[role]
      if (!roleId) throw new Error(`role ${role} was not seeded`)
      await db.userRole.create({ data: { userId, roleId, companyId } })
      seededUsers.push({ userId, role })
    }

    const projectId = ids.next()
    await db.project.create({
      data: {
        id: projectId,
        companyId,
        code: 'NKL-001',
        nameEn: 'Al Nakheel Tower',
        nameAr: 'برج النخيل',
        currency: 'SAR',
        status: 'in_progress',
      },
    })
    await db.unit.create({
      data: {
        id: ids.next(),
        companyId,
        projectId,
        unitNumber: '305',
        name: 'Unit 305',
        floor: 3,
        grossArea: '142.5',
        currency: 'SAR',
        status: 'in_progress',
      },
    })

    // The engineer holds `project.view`, not `view_all` — without an
    // assignment they legitimately see NOTHING, which is correct ABAC but a
    // confusing demo. Assign them to the seeded project.
    const engineer = seededUsers.find((u) => u.role === 'site_engineer')
    if (engineer) {
      await db.userAssignment.create({
        data: {
          id: ids.next(),
          companyId,
          userId: engineer.userId,
          scopeType: 'project',
          scopeId: projectId,
        },
      })
    }
  })

  console.warn('demo tenant created')
  console.warn(`  companyId: ${companyId}`)
  console.warn(`  users: ${users.map(([e]) => e).join(', ')}`)
  console.warn(`  password: ${PASSWORD}`)
}

main()
  .then(() => runWithoutTenantScope(sys, () => db.$disconnect()))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
