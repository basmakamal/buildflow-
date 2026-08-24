import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator } from '@buildflow/core'
import {
  OutboxRelay,
  withTenantScope,
  bindTenantContext,
  runWithoutTenantScope,
  type OutboxRow,
} from '@buildflow/database'
import { BalanceReconciliation, RECONCILIATION_DRIFT } from '@buildflow/catalogue'

/**
 * The two worker jobs against a real database: the outbox relay's
 * at-least-once drain with backoff, and the reconciliation that replays the
 * ledger, repairs the projection, and reports every drift as an outbox event.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const sys = { userId: null, requestId: 'test', source: 'system' as const, locale: 'en' }

let unitId: string
let materialId: string

beforeAll(async () => {
  await raw.$connect()
})

afterAll(async () => {
  await raw.$disconnect()
})

beforeEach(async () => {
  await runWithoutTenantScope(sys, async () => {
    await raw.outboxEvent.deleteMany({})
    await raw.budget.deleteMany({})
    await raw.costAllocation.deleteMany({})
    await raw.invoiceLine.deleteMany({})
    await raw.invoice.deleteMany({})
    await raw.goodsReceiptLine.deleteMany({})
    await raw.goodsReceipt.deleteMany({})
    await raw.purchaseOrderLine.deleteMany({})
    await raw.purchaseOrder.deleteMany({})
    await raw.purchaseRequestLine.deleteMany({})
    await raw.purchaseRequest.deleteMany({})
    await raw.supplier.deleteMany({})
    await raw.stockMovement.deleteMany({})
    await raw.materialBalance.deleteMany({})
    await raw.stageTransition.deleteMany({})
    await raw.unitStage.deleteMany({})
    await raw.unitWorkflow.deleteMany({})
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.kbRuleOverride.deleteMany({})
    await raw.materialUomConversion.deleteMany({})
    await raw.material.deleteMany({})
    await raw.room.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.user.deleteMany({})
    await raw.company.deleteMany({})

    await raw.company.create({
      data: {
        id: COMPANY,
        nameEn: 'Acme',
        nameAr: 'أكمي',
        slug: `acme-wrk-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })

    const projectId = ids.next()
    unitId = ids.next()
    materialId = ids.next()

    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'WRK-1',
        nameEn: 'P',
        nameAr: 'م',
        currency: 'SAR',
      },
    })
    await raw.unit.create({
      data: {
        id: unitId,
        companyId: COMPANY,
        projectId,
        unitNumber: '305',
        name: 'Unit 305',
        grossArea: '100',
        currency: 'SAR',
      },
    })

    const category = await raw.materialCategory.upsert({
      where: { code: 'wrk-tiles' },
      create: { code: 'wrk-tiles', nameEn: 'Tiles', nameAr: 'بلاط' },
      update: {},
    })
    await raw.material.create({
      data: {
        id: materialId,
        companyId: COMPANY,
        categoryId: category.id,
        sku: 'POR-60',
        nameEn: 'Porcelain 60x60',
        nameAr: 'بورسلين ٦٠×٦٠',
        baseUom: 'm2',
      },
    })
  })
})

const movement = (over: Record<string, unknown> = {}) => ({
  id: ids.next(),
  companyId: COMPANY,
  materialId,
  unitId,
  type: 'purchase_receipt' as const,
  direction: 'in' as const,
  quantity: '100',
  uom: 'm2' as const,
  totalCost: '4500',
  currency: 'SAR',
  occurredAt: new Date('2026-08-20T08:00:00Z'),
  recordedBy: ids.next(),
  source: 'system' as const,
  clientEventId: ids.next(),
  ...over,
})

const outboxRow = (over: Record<string, unknown> = {}) => ({
  id: ids.next(),
  companyId: COMPANY,
  aggregateType: 'Budget',
  aggregateId: ids.next(),
  eventType: 'budget.exceeded',
  eventVersion: 1,
  payload: { hello: 'world' },
  occurredAt: new Date('2026-08-20T08:00:00Z'),
  ...over,
})

describe('the outbox relay', () => {
  it('drains pending events oldest-first and stamps publishedAt', async () => {
    await runWithoutTenantScope(sys, () =>
      raw.outboxEvent.createMany({
        data: [
          outboxRow({ occurredAt: new Date('2026-08-20T09:00:00Z'), eventType: 'second' }),
          outboxRow({ occurredAt: new Date('2026-08-20T08:00:00Z'), eventType: 'first' }),
        ],
      }),
    )

    const seen: OutboxRow[] = []
    const relay = new OutboxRelay(db, {
      publish: (event) => {
        seen.push(event)
        return Promise.resolve()
      },
    })
    const published = await runWithoutTenantScope(sys, () => relay.drain())

    expect(published).toBe(2)
    expect(seen.map((event) => event.eventType)).toEqual(['first', 'second'])
    const remaining = await runWithoutTenantScope(sys, () =>
      raw.outboxEvent.count({ where: { publishedAt: null } }),
    )
    expect(remaining).toBe(0)
  })

  it('backs off a failing event instead of spinning on it', async () => {
    await runWithoutTenantScope(sys, () => raw.outboxEvent.create({ data: outboxRow() }))

    const relay = new OutboxRelay(db, {
      publish: () => Promise.reject(new Error('transport down')),
    })
    const published = await runWithoutTenantScope(sys, () => relay.drain())
    expect(published).toBe(0)

    const row = await runWithoutTenantScope(sys, () => raw.outboxEvent.findFirstOrThrow({}))
    expect(row.publishedAt).toBeNull()
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBe('transport down')
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now())

    // The backed-off row is invisible to the next drain until availableAt.
    const again = await runWithoutTenantScope(sys, () => relay.drain())
    expect(again).toBe(0)
    const after = await runWithoutTenantScope(sys, () => raw.outboxEvent.findFirstOrThrow({}))
    expect(after.attempts).toBe(1)
  })

  it('refuses to run without the cross-tenant bypass', async () => {
    const relay = new OutboxRelay(db, { publish: () => Promise.resolve() })
    await expect(relay.drain()).rejects.toThrow('runWithoutTenantScope')
  })
})

describe('the reconciliation', () => {
  const reconciliation = new BalanceReconciliation(db, () => ids.next())
  const run = () => runWithoutTenantScope(sys, () => reconciliation.run())

  it('finds nothing to say about a projection the ledger agrees with', async () => {
    await runWithoutTenantScope(sys, async () => {
      await raw.stockMovement.createMany({
        data: [
          movement(),
          movement({ type: 'consumption', direction: 'out', quantity: '40', totalCost: null }),
        ],
      })
      await raw.materialBalance.create({
        data: {
          id: ids.next(),
          companyId: COMPANY,
          unitId,
          unitStageId: null,
          stageKey: '',
          materialId,
          purchasedQuantity: '100',
          usedQuantity: '40',
          wastedQuantity: '0',
          returnedQuantity: '0',
          remainingQuantity: '60',
          actualCost: '4500',
          currency: 'SAR',
          uom: 'm2',
          recalculatedAt: new Date(),
        },
      })
    })

    const summary = await run()
    expect(summary.scopesChecked).toBe(1)
    expect(summary.drifts).toHaveLength(0)
  })

  it('repairs a drifted projection and reports the drift as an outbox event', async () => {
    await runWithoutTenantScope(sys, async () => {
      await raw.stockMovement.createMany({
        data: [
          movement(),
          movement({ type: 'consumption', direction: 'out', quantity: '40', totalCost: null }),
        ],
      })
      // The corruption: a mutated counter the ledger never authorised.
      await raw.materialBalance.create({
        data: {
          id: ids.next(),
          companyId: COMPANY,
          unitId,
          unitStageId: null,
          stageKey: '',
          materialId,
          purchasedQuantity: '100',
          usedQuantity: '25',
          wastedQuantity: '0',
          returnedQuantity: '0',
          remainingQuantity: '75',
          actualCost: '4500',
          currency: 'SAR',
          uom: 'm2',
          recalculatedAt: new Date(),
        },
      })
    })

    const summary = await run()
    expect(summary.drifts).toHaveLength(1)
    expect(summary.drifts[0]!.repaired).toBe(true)
    expect(summary.drifts[0]!.fields).toEqual(
      expect.arrayContaining([
        { field: 'usedQuantity', expected: '40.0000', found: '25.0000' },
        { field: 'remainingQuantity', expected: '60.0000', found: '75.0000' },
      ]),
    )

    const repaired = await runWithoutTenantScope(sys, () =>
      raw.materialBalance.findFirstOrThrow({}),
    )
    expect(String(repaired.usedQuantity)).toBe('40')
    expect(String(repaired.remainingQuantity)).toBe('60')

    const alert = await runWithoutTenantScope(sys, () =>
      raw.outboxEvent.findFirstOrThrow({ where: { eventType: RECONCILIATION_DRIFT } }),
    )
    expect(alert.companyId).toBe(COMPANY)
    expect(alert.publishedAt).toBeNull()

    // Once repaired, the next run reports zero drift — the number the Phase 3
    // exit criterion watches for 30 days.
    const again = await run()
    expect(again.drifts).toHaveLength(0)
  })

  it('treats a ledger scope with no projection row as drift and creates it', async () => {
    await runWithoutTenantScope(sys, () => raw.stockMovement.createMany({ data: [movement()] }))

    const summary = await run()
    expect(summary.drifts).toHaveLength(1)
    expect(summary.drifts[0]!.fields[0]).toMatchObject({ found: 'missing' })

    const created = await runWithoutTenantScope(sys, () => raw.materialBalance.findFirstOrThrow({}))
    expect(String(created.purchasedQuantity)).toBe('100')
    expect(String(created.remainingQuantity)).toBe('100')
  })

  it('refuses to run without the cross-tenant bypass', async () => {
    await expect(reconciliation.run()).rejects.toThrow('runWithoutTenantScope')
  })
})
