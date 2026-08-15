import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  MissingTenantContextError,
  Uuid7Generator,
  type CompanyId,
  type UserId,
} from '@buildflow/core'
import { withTenantScope } from '../src/tenant-extension'
import { bindTenantContext } from '../src/bind-context'
import { runWithTenantContext, runWithoutTenantScope } from '../src/tenant-context'

/**
 * THE GATE.
 *
 * This suite exists because cross-tenant data access is the one bug class that
 * ends a B2B SaaS company. It is a separate, non-negotiable CI job rather than
 * a few cases folded into general coverage, and every new repository must be
 * represented here.
 *
 * The approach is adversarial: seed two companies, then actively TRY to read,
 * update, and delete across the boundary using every Prisma operation. A test
 * that only checks the happy path proves nothing about isolation.
 * docs/11 §4, docs/16 §3
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
// Composed exactly as createDatabase() does, so the suite tests the real thing.
// The un-awaited call style below is deliberate: it is the shape that broke
// before bindTenantContext existed.
const db = bindTenantContext(withTenantScope(raw))

const ACME = ids.next<'CompanyId'>() as CompanyId
const GLOBEX = ids.next<'CompanyId'>() as CompanyId
const SYSTEM_USER = ids.next<'UserId'>() as UserId

const ctx = (companyId: CompanyId) => ({
  companyId,
  userId: SYSTEM_USER,
  requestId: 'test',
  source: 'system' as const,
  locale: 'en',
})

/** Ids of rows owned by each tenant, captured at seed time. */
let acmeProjectId: string
let globexProjectId: string
let acmeUnitId: string
let globexUnitId: string

beforeAll(async () => {
  await raw.$connect()
})

afterAll(async () => {
  await raw.$disconnect()
})

beforeEach(async () => {
  // Seeding runs unscoped — it is legitimately cross-tenant, and doing it this
  // way also proves the bypass works.
  await runWithoutTenantScope(
    { userId: null, requestId: 'seed', source: 'system', locale: 'en' },
    async () => {
      await raw.unit.deleteMany({})
      await raw.project.deleteMany({})
      await raw.user.deleteMany({})
      await raw.outboxEvent.deleteMany({})
      await raw.company.deleteMany({})

      await raw.company.createMany({
        data: [
          {
            id: ACME,
            nameEn: 'Acme Finishing',
            nameAr: 'أكمي للتشطيبات',
            slug: `acme-${String(Date.now())}`,
            countryCode: 'SA',
            defaultCurrency: 'SAR',
          },
          {
            id: GLOBEX,
            nameEn: 'Globex Contracting',
            nameAr: 'جلوبكس للمقاولات',
            slug: `globex-${String(Date.now())}`,
            countryCode: 'AE',
            defaultCurrency: 'AED',
          },
        ],
      })

      acmeProjectId = ids.next()
      globexProjectId = ids.next()
      await raw.project.createMany({
        data: [
          {
            id: acmeProjectId,
            companyId: ACME,
            code: 'ACME-001',
            nameEn: 'Al Nakheel Tower',
            nameAr: 'برج النخيل',
            currency: 'SAR',
          },
          {
            id: globexProjectId,
            companyId: GLOBEX,
            code: 'GLX-001',
            nameEn: 'Marina Residences',
            nameAr: 'مساكن المارينا',
            currency: 'AED',
          },
        ],
      })

      acmeUnitId = ids.next()
      globexUnitId = ids.next()
      await raw.unit.createMany({
        data: [
          {
            id: acmeUnitId,
            companyId: ACME,
            projectId: acmeProjectId,
            unitNumber: '305',
            name: 'Unit 305',
            grossArea: '142.5',
            currency: 'SAR',
          },
          {
            id: globexUnitId,
            companyId: GLOBEX,
            projectId: globexProjectId,
            unitNumber: '101',
            name: 'Unit 101',
            grossArea: '98.2',
            currency: 'AED',
          },
        ],
      })
    },
  )
})

describe('tenant isolation', () => {
  describe('reads', () => {
    it('findMany returns only the current tenant rows', async () => {
      const acme = await runWithTenantContext(ctx(ACME), () => db.unit.findMany())
      expect(acme).toHaveLength(1)
      expect(acme[0]!.unitNumber).toBe('305')

      const globex = await runWithTenantContext(ctx(GLOBEX), () => db.unit.findMany())
      expect(globex).toHaveLength(1)
      expect(globex[0]!.unitNumber).toBe('101')
    })

    it('findFirst cannot reach another tenant row by id', async () => {
      const stolen = await runWithTenantContext(ctx(ACME), () =>
        db.unit.findFirst({ where: { id: globexUnitId } }),
      )
      expect(stolen).toBeNull()
    })

    it('findUnique cannot reach another tenant row by primary key', async () => {
      // The hole that closes only because Prisma 5 allows extra predicates
      // alongside a unique field. Before that, this call would have returned
      // Globex's row.
      const stolen = await runWithTenantContext(ctx(ACME), () =>
        db.unit.findUnique({ where: { id: globexUnitId } }),
      )
      expect(stolen).toBeNull()
    })

    it('count excludes other tenants', async () => {
      const total = await runWithTenantContext(ctx(ACME), () => db.unit.count())
      expect(total).toBe(1)
    })

    it('aggregate excludes other tenants', async () => {
      const result = await runWithTenantContext(ctx(ACME), () =>
        db.unit.aggregate({ _sum: { grossArea: true } }),
      )
      expect(Number(result._sum.grossArea)).toBeCloseTo(142.5, 1)
    })

    it('groupBy excludes other tenants', async () => {
      const groups = await runWithTenantContext(ctx(ACME), () =>
        db.unit.groupBy({ by: ['status'], _count: true }),
      )
      expect(groups.reduce((n, g) => n + g._count, 0)).toBe(1)
    })

    it('a nested relation cannot leak across the boundary', async () => {
      const projects = await runWithTenantContext(ctx(ACME), () =>
        db.project.findMany({ include: { units: true } }),
      )
      expect(projects).toHaveLength(1)
      expect(projects[0]!.units.every((u) => u.companyId === ACME)).toBe(true)
    })
  })

  describe('writes', () => {
    it('create stamps the current tenant even if another is supplied', async () => {
      const id = ids.next()
      await runWithTenantContext(ctx(ACME), () =>
        db.unit.create({
          data: {
            id,
            // A caller trying to plant a row in another tenant. The extension
            // overwrites it — injection wins over caller-supplied data.
            companyId: GLOBEX,
            projectId: acmeProjectId,
            unitNumber: '999',
            name: 'Injected',
            grossArea: '10',
            currency: 'SAR',
          },
        }),
      )

      const row = await runWithoutTenantScope(
        { userId: null, requestId: 't', source: 'system', locale: 'en' },
        () => raw.unit.findUnique({ where: { id } }),
      )
      expect(row!.companyId).toBe(ACME)
    })

    it('update cannot modify another tenant row', async () => {
      const result = await runWithTenantContext(ctx(ACME), () =>
        db.unit.updateMany({ where: { id: globexUnitId }, data: { name: 'HACKED' } }),
      )
      expect(result.count).toBe(0)

      const untouched = await runWithTenantContext(ctx(GLOBEX), () =>
        db.unit.findFirst({ where: { id: globexUnitId } }),
      )
      expect(untouched!.name).toBe('Unit 101')
    })

    it('delete cannot remove another tenant row', async () => {
      const result = await runWithTenantContext(ctx(ACME), () =>
        db.unit.deleteMany({ where: { id: globexUnitId } }),
      )
      expect(result.count).toBe(0)

      const survivors = await runWithTenantContext(ctx(GLOBEX), () => db.unit.count())
      expect(survivors).toBe(1)
    })

    it('deleteMany with no filter deletes only the current tenant', async () => {
      // The catastrophic case: an unfiltered destructive operation.
      await runWithTenantContext(ctx(ACME), () => db.unit.deleteMany({}))

      const acmeLeft = await runWithTenantContext(ctx(ACME), () => db.unit.count())
      const globexLeft = await runWithTenantContext(ctx(GLOBEX), () => db.unit.count())
      expect(acmeLeft).toBe(0)
      expect(globexLeft).toBe(1)
    })

    it('createMany stamps every row', async () => {
      await runWithTenantContext(ctx(ACME), () =>
        db.unit.createMany({
          data: [
            {
              id: ids.next(),
              projectId: acmeProjectId,
              unitNumber: '401',
              name: 'A',
              grossArea: '80',
              currency: 'SAR',
            },
            {
              id: ids.next(),
              projectId: acmeProjectId,
              unitNumber: '402',
              name: 'B',
              grossArea: '85',
              currency: 'SAR',
            },
          ] as never,
        }),
      )
      const all = await runWithTenantContext(ctx(ACME), () => db.unit.findMany())
      expect(all).toHaveLength(3)
      expect(all.every((u) => u.companyId === ACME)).toBe(true)
    })
  })

  describe('missing context', () => {
    it('throws rather than returning unscoped data', async () => {
      // The critical behaviour. Falling through would silently read every
      // tenant — a breach no test would catch and no log would show.
      await expect(db.unit.findMany()).rejects.toThrow(MissingTenantContextError)
    })

    it('names the model and operation so the bug is findable', async () => {
      await expect(db.project.count()).rejects.toThrow(/Project\.count/)
    })

    it('blocks writes too', async () => {
      await expect(
        db.unit.create({
          data: {
            id: ids.next(),
            projectId: acmeProjectId,
            unitNumber: 'X',
            name: 'X',
            grossArea: '1',
            currency: 'SAR',
          } as never,
        }),
      ).rejects.toThrow(MissingTenantContextError)
    })
  })

  describe('explicit bypass', () => {
    it('reaches every tenant when deliberately requested', async () => {
      const all = await runWithoutTenantScope(
        { userId: null, requestId: 'platform-job', source: 'system', locale: 'en' },
        () => db.unit.findMany(),
      )
      expect(all).toHaveLength(2)
    })

    it('does not leak into a subsequent scoped call', async () => {
      await runWithoutTenantScope(
        { userId: null, requestId: 'job', source: 'system', locale: 'en' },
        () => db.unit.findMany(),
      )
      const scoped = await runWithTenantContext(ctx(ACME), () => db.unit.findMany())
      expect(scoped).toHaveLength(1)
    })
  })

  describe('context propagation', () => {
    it('survives await boundaries', async () => {
      const result = await runWithTenantContext(ctx(ACME), async () => {
        await new Promise((r) => setTimeout(r, 10))
        await db.project.findMany()
        await new Promise((r) => setTimeout(r, 10))
        return db.unit.findMany()
      })
      expect(result).toHaveLength(1)
    })

    it('keeps concurrent tenants separate', async () => {
      // Two requests in flight at once must not see each other's context —
      // the property AsyncLocalStorage exists to provide.
      const [acme, globex] = await Promise.all([
        runWithTenantContext(ctx(ACME), async () => {
          await new Promise((r) => setTimeout(r, 20))
          return db.unit.findMany()
        }),
        runWithTenantContext(ctx(GLOBEX), async () => {
          await new Promise((r) => setTimeout(r, 5))
          return db.unit.findMany()
        }),
      ])
      expect(acme[0]!.unitNumber).toBe('305')
      expect(globex[0]!.unitNumber).toBe('101')
    })
  })
})
