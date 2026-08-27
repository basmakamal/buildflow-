import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { Uuid7Generator } from '@buildflow/core'
import { withTenantScope, bindTenantContext, runWithoutTenantScope } from '@buildflow/database'
import {
  Argon2PasswordHasher,
  seedCompanyRoles,
  seedPermissionCatalogue,
} from '@buildflow/identity'
import { emptyGeometry, defaultLayers, type PlanGeometry } from '@buildflow/spatial'
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * Floor plans over HTTP — persistence, versioning and the advisory lock.
 * docs/04 §2.5, docs/08 §7.6
 *
 * What this suite is really protecting is the case where somebody's afternoon
 * disappears: two editors on one plan, a stale tab that comes back to life, a
 * restore that lands on top of a save. None of those raise an error by
 * themselves — the only thing standing between them and lost work is the
 * version guard and the lock, so both are exercised against a real database
 * rather than a stub that would agree with whatever the code does.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const RIVAL = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let mateToken: string
let unitId: string
let rivalUnitId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const call =
  (token: string) =>
  (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const options: InjectOptions = { method, url, headers: { authorization: `Bearer ${token}` } }
    if (payload !== undefined) options.payload = payload as never
    return app.inject(options)
  }

const api = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  call(ownerToken)(method, url, payload)
const asMate = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  call(mateToken)(method, url, payload)

/** A 6 × 4 m room: four walls that close, so detection has something to find. */
const room = (): PlanGeometry => ({
  ...emptyGeometry(defaultLayers()),
  walls: [
    { id: 'w1', start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } },
    { id: 'w2', start: { x: 6000, y: 0 }, end: { x: 6000, y: 4000 } },
    { id: 'w3', start: { x: 6000, y: 4000 }, end: { x: 0, y: 4000 } },
    { id: 'w4', start: { x: 0, y: 4000 }, end: { x: 0, y: 0 } },
  ].map((wall) => ({ ...wall, thicknessMm: 200, heightMm: 3000, layer: 'default' })),
})

const openPlan = async () => {
  const created = await api('POST', `/api/v1/units/${unitId}/plan`)
  return created.json<{ data: { id: string; version: number } }>().data
}

beforeAll(async () => {
  await raw.$connect()
  app = await buildServer({
    container: createContainer({ db, jwtSecret: randomBytes(32).toString('base64url') }),
    db,
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await raw.$disconnect()
})

beforeEach(async () => {
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)

  await runWithoutTenantScope(sys, async () => {
    await raw.planOpening.deleteMany({})
    await raw.planWall.deleteMany({})
    await raw.planStructuralElement.deleteMany({})
    await raw.planRoomBoundary.deleteMany({})
    await raw.planRevision.deleteMany({})
    await raw.floorPlan.deleteMany({})
    await raw.refreshToken.deleteMany({})
    await raw.session.deleteMany({})
    await raw.loginAttempt.deleteMany({})
    await raw.auditLog.deleteMany({})
    await raw.userAssignment.deleteMany({})
    await raw.userRole.deleteMany({})
    await raw.rolePermission.deleteMany({})
    await raw.role.deleteMany({})
    await raw.room.deleteMany({})
    await raw.unit.deleteMany({})
    await raw.project.deleteMany({})
    await raw.user.deleteMany({})
    await raw.company.deleteMany({})

    await raw.company.createMany({
      data: [
        {
          id: COMPANY,
          nameEn: 'Acme',
          nameAr: 'أكمي',
          slug: `acme-${String(Date.now())}`,
          countryCode: 'SA',
          defaultCurrency: 'SAR',
        },
        {
          id: RIVAL,
          nameEn: 'Rival',
          nameAr: 'منافس',
          slug: `rival-${String(Date.now())}`,
          countryCode: 'AE',
          defaultCurrency: 'AED',
        },
      ],
    })

    const project = ids.next()
    unitId = ids.next()
    await raw.project.create({
      data: {
        id: project,
        companyId: COMPANY,
        code: 'PLN-1',
        nameEn: 'Tower',
        nameAr: 'برج',
        currency: 'SAR',
      },
    })
    await raw.unit.create({
      data: {
        id: unitId,
        companyId: COMPANY,
        projectId: project,
        unitNumber: '101',
        name: 'Unit 101',
        grossArea: '120',
        currency: 'SAR',
      },
    })

    const rivalProject = ids.next()
    rivalUnitId = ids.next()
    await raw.project.create({
      data: {
        id: rivalProject,
        companyId: RIVAL,
        code: 'RVL-1',
        nameEn: 'Rival',
        nameAr: 'منافس',
        currency: 'AED',
      },
    })
    await raw.unit.create({
      data: {
        id: rivalUnitId,
        companyId: RIVAL,
        projectId: rivalProject,
        unitNumber: '101',
        name: 'Rival Unit',
        grossArea: '99',
        currency: 'AED',
      },
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  const roleIds = await runWithoutTenantScope(sys, () =>
    seedCompanyRoles(db, COMPANY, () => ids.next()),
  )

  const stamp = String(Date.now())
  const owner = { id: ids.next(), email: `owner-${stamp}@acme.sa` }
  const mate = { id: ids.next(), email: `mate-${stamp}@acme.sa` }

  await runWithoutTenantScope(sys, async () => {
    for (const [person, first] of [
      [owner, 'Owner'],
      [mate, 'Sara'],
    ] as const) {
      await raw.user.create({
        data: {
          id: person.id,
          companyId: COMPANY,
          email: person.email,
          passwordHash: hash,
          firstNameEn: first,
          lastNameEn: 'User',
          status: 'active',
        },
      })
      await raw.userRole.create({
        data: { userId: person.id, roleId: roleIds['company_owner']!, companyId: COMPANY },
      })
    }
  })

  const login = async (email: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { companyId: COMPANY, email, password: PASSWORD },
      })
    ).json<{ accessToken: string }>().accessToken

  ownerToken = await login(owner.email)
  mateToken = await login(mate.email)
})

describe('opening a plan', () => {
  it('creates one for a unit that has none', async () => {
    const res = await api('POST', `/api/v1/units/${unitId}/plan`)

    expect(res.statusCode).toBe(201)
    expect(res.json<{ data: { version: number } }>().data.version).toBe(1)
  })

  it('is idempotent, because every tab that opens the planner tries it', async () => {
    const first = await openPlan()
    const second = await api('POST', `/api/v1/units/${unitId}/plan`)

    // Two plans for one unit is not a state the BOQ could make sense of.
    expect(second.json<{ data: { id: string } }>().data.id).toBe(first.id)
    expect(await raw.floorPlan.count({ where: { unitId } })).toBe(1)
  })

  it('404s for a unit with no plan yet', async () => {
    expect((await api('GET', `/api/v1/units/${unitId}/plan`)).statusCode).toBe(404)
  })

  it('404s across tenants rather than 403, which would confirm it exists', async () => {
    expect((await api('GET', `/api/v1/units/${rivalUnitId}/plan`)).statusCode).toBe(404)
  })
})

describe('saving', () => {
  it('writes the geometry and bumps the version', async () => {
    const plan = await openPlan()
    const res = await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: plan.version,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json<{ data: { version: number } }>().data.version).toBe(2)

    const loaded = await api('GET', `/api/v1/units/${unitId}/plan`)
    expect(loaded.json<{ data: { geometry: PlanGeometry } }>().data.geometry.walls).toHaveLength(4)
  })

  it('writes the normalised rows the BOQ take-off reads, not just the cache', async () => {
    const plan = await openPlan()
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [
        {
          id: 'room:w1|w2|w3|w4',
          signature: 'w1|w2|w3|w4',
          typeCode: 'majlis',
          name: 'Majlis',
          polygon: [
            { x: 0, y: 0 },
            { x: 6000, y: 0 },
            { x: 6000, y: 4000 },
            { x: 0, y: 4000 },
          ],
          areaMm2: 24_000_000,
          perimeterMm: 20_000,
          wallIds: ['w1', 'w2', 'w3', 'w4'],
          ceilingHeightMm: 3000,
        },
      ],
      expectedVersion: plan.version,
    })

    const walls = await runWithoutTenantScope(sys, () =>
      raw.planWall.findMany({ where: { floorPlanId: plan.id } }),
    )
    const rooms = await runWithoutTenantScope(sys, () =>
      raw.planRoomBoundary.findMany({ where: { floorPlanId: plan.id } }),
    )

    expect(walls).toHaveLength(4)
    // Square millimetres in the plan, square METRES in the row a BOQ prices.
    expect(Number(rooms[0]?.computedArea)).toBeCloseTo(24, 4)
    expect(rooms[0]?.name).toBe('Majlis')
  })

  it('refuses a stale version instead of overwriting work it never saw', async () => {
    const plan = await openPlan()
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: plan.version,
    })

    const stale = await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: emptyGeometry(),
      rooms: [],
      expectedVersion: plan.version,
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json<{ code: string }>().code).toBe('CONCURRENT_MODIFICATION')
  })

  it('replaces rather than accumulates — a deleted wall stays deleted', async () => {
    const plan = await openPlan()
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: 1,
    })
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: { ...room(), walls: room().walls.slice(0, 2) },
      rooms: [],
      expectedVersion: 2,
    })

    const walls = await runWithoutTenantScope(sys, () =>
      raw.planWall.findMany({ where: { floorPlanId: plan.id } }),
    )
    expect(walls).toHaveLength(2)
  })
})

describe('the advisory lock', () => {
  it('is given to the first editor and refused to the second', async () => {
    const plan = await openPlan()

    expect((await api('POST', `/api/v1/plans/${plan.id}/lock`)).statusCode).toBe(200)

    const blocked = await asMate('POST', `/api/v1/plans/${plan.id}/lock`)
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json<{ code: string }>().code).toBe('PLAN_LOCKED')
    // Whoever is blocked needs a NAME, not an id. The problem document's
    // `title` is where the domain's message lands. docs/07 §9
    expect(blocked.json<{ title: string }>().title).toContain('Owner User')
  })

  it('refreshes for the holder, so the heartbeat is the same call', async () => {
    const plan = await openPlan()
    const first = await api('POST', `/api/v1/plans/${plan.id}/lock`)
    const second = await api('POST', `/api/v1/plans/${plan.id}/lock`)

    expect(second.statusCode).toBe(200)
    expect(
      new Date(second.json<{ data: { expiresAt: string } }>().data.expiresAt).getTime(),
    ).toBeGreaterThanOrEqual(
      new Date(first.json<{ data: { expiresAt: string } }>().data.expiresAt).getTime(),
    )
  })

  it('stops a second editor SAVING, not merely locking', async () => {
    const plan = await openPlan()
    await api('POST', `/api/v1/plans/${plan.id}/lock`)

    const res = await asMate('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: plan.version,
    })

    expect(res.statusCode).toBe(409)
    expect(res.json<{ code: string }>().code).toBe('PLAN_LOCKED')
  })

  it('frees the plan on release', async () => {
    const plan = await openPlan()
    await api('POST', `/api/v1/plans/${plan.id}/lock`)
    await api('DELETE', `/api/v1/plans/${plan.id}/lock`)

    expect((await asMate('POST', `/api/v1/plans/${plan.id}/lock`)).statusCode).toBe(200)
  })

  it('refuses a release by somebody who never held it', async () => {
    const plan = await openPlan()
    await api('POST', `/api/v1/plans/${plan.id}/lock`)

    expect((await asMate('DELETE', `/api/v1/plans/${plan.id}/lock`)).statusCode).toBe(403)
  })

  it('does not disturb the geometry version', async () => {
    const plan = await openPlan()
    await api('POST', `/api/v1/plans/${plan.id}/lock`)
    await api('POST', `/api/v1/plans/${plan.id}/lock`)

    // A heartbeat that bumped the version would fail the next save for a
    // conflict that never happened.
    const res = await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: plan.version,
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('revisions', () => {
  it('names a snapshot and lists it without the megabytes', async () => {
    const plan = await openPlan()
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: 1,
    })

    const created = await api('POST', `/api/v1/plans/${plan.id}/revisions`, {
      name: 'Before the client meeting',
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<{ data: { revisionNumber: number } }>().data.revisionNumber).toBe(1)

    const list = await api('GET', `/api/v1/plans/${plan.id}/revisions`)
    const [summary] = list.json<{ data: { objectCount: number; snapshot?: unknown }[] }>().data
    expect(summary?.objectCount).toBe(4)
    expect(summary?.snapshot).toBeUndefined()
  })

  it('insists on a name, because a list of numbers is not a history', async () => {
    const plan = await openPlan()
    const res = await api('POST', `/api/v1/plans/${plan.id}/revisions`, { name: '  ' })

    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('REVISION_NAME_REQUIRED')
  })

  it('restores the drawing as a new version', async () => {
    const plan = await openPlan()
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: 1,
    })
    const revision = (
      await api('POST', `/api/v1/plans/${plan.id}/revisions`, { name: 'Four walls' })
    ).json<{ data: { id: string } }>().data

    // …then somebody deletes everything.
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: emptyGeometry(),
      rooms: [],
      expectedVersion: 2,
    })
    expect(
      (await api('GET', `/api/v1/units/${unitId}/plan`)).json<{
        data: { geometry: PlanGeometry }
      }>().data.geometry.walls,
    ).toHaveLength(0)

    const restored = await api('POST', `/api/v1/plans/${plan.id}/revisions/${revision.id}/restore`)
    expect(restored.statusCode).toBe(200)

    const loaded = await api('GET', `/api/v1/units/${unitId}/plan`)
    const data = loaded.json<{ data: { geometry: PlanGeometry; version: number } }>().data
    expect(data.geometry.walls).toHaveLength(4)
    // A new version, not a rewind — so the restore is itself undoable.
    expect(data.version).toBe(4)
  })

  it('refuses to restore over somebody else editing', async () => {
    const plan = await openPlan()
    await api('PUT', `/api/v1/plans/${plan.id}`, {
      geometry: room(),
      rooms: [],
      expectedVersion: 1,
    })
    const revision = (
      await api('POST', `/api/v1/plans/${plan.id}/revisions`, { name: 'Four walls' })
    ).json<{ data: { id: string } }>().data

    await asMate('POST', `/api/v1/plans/${plan.id}/lock`)
    const res = await api('POST', `/api/v1/plans/${plan.id}/revisions/${revision.id}/restore`)

    expect(res.statusCode).toBe(409)
  })
})
