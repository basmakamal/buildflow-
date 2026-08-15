import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator, type CompanyId, type UserId } from '@buildflow/core'
import { withTenantScope } from '../src/tenant-extension'
import { bindTenantContext } from '../src/bind-context'
import { runWithTenantContext, runWithoutTenantScope } from '../src/tenant-context'
import { AuditWriter } from '../src/audit'
import { PrismaUnitOfWork } from '../src/unit-of-work'

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))
const uow = new PrismaUnitOfWork(db)
const audit = new AuditWriter(() => ids.next())

const ACME = ids.next<'CompanyId'>() as CompanyId
const GLOBEX = ids.next<'CompanyId'>() as CompanyId
const ACTOR = ids.next<'UserId'>() as UserId

const ctx = (companyId: CompanyId) => ({
  companyId,
  userId: ACTOR,
  requestId: 'req-audit',
  source: 'web' as const,
  locale: 'ar',
})

let projectId: string

beforeAll(async () => {
  await raw.$connect()
})
afterAll(async () => {
  await raw.$disconnect()
})

beforeEach(async () => {
  await runWithoutTenantScope(
    { userId: null, requestId: 'seed', source: 'system', locale: 'en' },
    async () => {
      await raw.auditLog.deleteMany({})
      await raw.unit.deleteMany({})
      await raw.project.deleteMany({})
      await raw.company.deleteMany({})
      await raw.company.createMany({
        data: [
          {
            id: ACME,
            nameEn: 'Acme',
            nameAr: 'أكمي',
            slug: `acme-${String(Date.now())}`,
            countryCode: 'SA',
            defaultCurrency: 'SAR',
          },
          {
            id: GLOBEX,
            nameEn: 'Globex',
            nameAr: 'جلوبكس',
            slug: `globex-${String(Date.now())}`,
            countryCode: 'AE',
            defaultCurrency: 'AED',
          },
        ],
      })
      projectId = ids.next()
      await raw.project.create({
        data: {
          id: projectId,
          companyId: ACME,
          code: 'P-1',
          nameEn: 'Tower',
          nameAr: 'برج',
          currency: 'SAR',
        },
      })
    },
  )
})

describe('AuditWriter', () => {
  it('writes a record inside the caller transaction', async () => {
    await runWithTenantContext(ctx(ACME), () =>
      uow.transaction(async (tx) => {
        await audit.write(tx, {
          action: 'project.updated',
          entityType: 'Project',
          entityId: projectId,
          entityLabel: 'Tower',
          before: { nameEn: 'Tower' },
          after: { nameEn: 'Tower Renamed' },
        })
      }),
    )

    const rows = await runWithTenantContext(ctx(ACME), () => db.auditLog.findMany())
    expect(rows).toHaveLength(1)
    expect(rows[0]!.action).toBe('project.updated')
    expect(rows[0]!.actorUserId).toBe(ACTOR)
    expect(rows[0]!.requestId).toBe('req-audit')
    expect(rows[0]!.source).toBe('web')
  })

  it('records only the fields that actually changed', async () => {
    await runWithTenantContext(ctx(ACME), () =>
      uow.transaction(async (tx) => {
        await audit.write(tx, {
          action: 'unit.updated',
          entityType: 'Unit',
          entityId: projectId,
          before: { name: 'A', area: '100', floor: 3 },
          after: { name: 'B', area: '100', floor: 4 },
        })
      }),
    )

    const row = await runWithTenantContext(ctx(ACME), () => db.auditLog.findFirst())
    expect(row!.changedFields).toEqual(['name', 'floor'])
  })

  describe('transactional guarantee', () => {
    it('rolls back the audit record when the transaction fails', async () => {
      // THE POINT OF WRITING IN-TRANSACTION. An audit trail that records
      // changes which never happened is as untrustworthy as one that misses
      // changes that did.
      await expect(
        runWithTenantContext(ctx(ACME), () =>
          uow.transaction(async (tx) => {
            await audit.write(tx, {
              action: 'project.updated',
              entityType: 'Project',
              entityId: projectId,
            })
            throw new Error('business rule failed after the audit write')
          }),
        ),
      ).rejects.toThrow('business rule failed')

      const rows = await runWithTenantContext(ctx(ACME), () => db.auditLog.findMany())
      expect(rows).toHaveLength(0)
    })

    it('commits the change and its audit record together', async () => {
      await runWithTenantContext(ctx(ACME), () =>
        uow.transaction(async (tx) => {
          await tx.project.update({
            where: { id: projectId, companyId: ACME },
            data: { nameEn: 'Renamed Tower' },
          })
          await audit.write(tx, {
            action: 'project.updated',
            entityType: 'Project',
            entityId: projectId,
            before: { nameEn: 'Tower' },
            after: { nameEn: 'Renamed Tower' },
          })
        }),
      )

      const project = await runWithTenantContext(ctx(ACME), () => db.project.findFirst())
      const rows = await runWithTenantContext(ctx(ACME), () => db.auditLog.findMany())
      expect(project!.nameEn).toBe('Renamed Tower')
      expect(rows).toHaveLength(1)
    })
  })

  describe('reason enforcement', () => {
    it('rejects a cost override with no stated reason', async () => {
      // before/after answers "what changed". Only a reason answers "why", and
      // that is the question that settles a dispute months later.
      await expect(
        runWithTenantContext(ctx(ACME), () =>
          uow.transaction((tx) =>
            audit.write(tx, {
              action: 'cost.overridden',
              entityType: 'BoqLine',
              entityId: projectId,
            }),
          ),
        ),
      ).rejects.toThrow(/requires a reason/)
    })

    it('rejects a whitespace-only reason', async () => {
      await expect(
        runWithTenantContext(ctx(ACME), () =>
          uow.transaction((tx) =>
            audit.write(tx, {
              action: 'stage.rejected',
              entityType: 'UnitStage',
              entityId: projectId,
              reason: '   ',
            }),
          ),
        ),
      ).rejects.toThrow(/requires a reason/)
    })

    it('accepts a stated reason', async () => {
      await runWithTenantContext(ctx(ACME), () =>
        uow.transaction((tx) =>
          audit.write(tx, {
            action: 'cost.overridden',
            entityType: 'BoqLine',
            entityId: projectId,
            reason: 'Site measurement corrected after demolition',
          }),
        ),
      )
      const row = await runWithTenantContext(ctx(ACME), () => db.auditLog.findFirst())
      expect(row!.reason).toContain('Site measurement corrected')
    })
  })

  it('refuses to write without tenant context', async () => {
    await expect(
      uow.transaction((tx) =>
        audit.write(tx, { action: 'x.y', entityType: 'Z', entityId: projectId }),
      ),
    ).rejects.toThrow(/without tenant context/)
  })

  describe('tenant isolation', () => {
    it('never returns another tenant audit trail', async () => {
      await runWithTenantContext(ctx(ACME), () =>
        uow.transaction((tx) =>
          audit.write(tx, { action: 'a.b', entityType: 'Project', entityId: projectId }),
        ),
      )

      const globexView = await runWithTenantContext(ctx(GLOBEX), () => db.auditLog.findMany())
      expect(globexView).toHaveLength(0)

      const acmeView = await runWithTenantContext(ctx(ACME), () => db.auditLog.findMany())
      expect(acmeView).toHaveLength(1)
    })

    it('stamps the acting tenant, not one supplied by the caller', async () => {
      await runWithTenantContext(ctx(ACME), () =>
        uow.transaction((tx) =>
          audit.write(tx, { action: 'a.b', entityType: 'Project', entityId: projectId }),
        ),
      )
      const row = await runWithoutTenantScope(
        { userId: null, requestId: 'check', source: 'system', locale: 'en' },
        () => raw.auditLog.findFirst(),
      )
      expect(row!.companyId).toBe(ACME)
    })
  })
})
