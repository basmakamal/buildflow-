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
import { buildServer } from '../src/server'
import { createContainer } from '../src/container'

/**
 * The project → unit → rooms journey, end to end over HTTP.
 *
 * This is the first slice of the actual product loop, so the suite follows a
 * realistic sequence — create a project, move it through its lifecycle, add a
 * unit, fill it with rooms, read back the geometry a BOQ would consume — and
 * then attacks the boundaries: duplicate codes, illegal transitions, and
 * cross-tenant reads.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const RIVAL = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let ownerToken: string
let rivalUnitId: string

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

/**
 * Options built imperatively rather than with a conditional spread: the spread
 * of a `{} | { payload }` union defeats TypeScript's overload resolution on
 * `app.inject`, and every downstream `.json()` call then types as unresolved.
 */
const api = (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const options: InjectOptions = {
    method,
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
  }
  if (payload !== undefined) options.payload = payload as never
  return app.inject(options)
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

    // A rival-tenant unit, used to prove cross-tenant reads 404.
    const rivalProject = ids.next()
    rivalUnitId = ids.next()
    await raw.project.create({
      data: {
        id: rivalProject,
        companyId: RIVAL,
        code: 'RVL-1',
        nameEn: 'Rival Tower',
        nameAr: 'برج',
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

  const email = `owner-${String(Date.now())}@acme.sa`
  const userId = ids.next()
  await runWithoutTenantScope(sys, async () => {
    await raw.user.create({
      data: {
        id: userId,
        companyId: COMPANY,
        email,
        passwordHash: hash,
        firstNameEn: 'Owner',
        lastNameEn: 'User',
        status: 'active',
      },
    })
    await raw.userRole.create({
      data: { userId, roleId: roleIds['company_owner']!, companyId: COMPANY },
    })
  })

  ownerToken = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { companyId: COMPANY, email, password: PASSWORD },
    })
  ).json<{ accessToken: string }>().accessToken
})

describe('project lifecycle', () => {
  it('creates a project in planned status', async () => {
    const res = await api('POST', '/api/v1/projects', {
      code: 'NKL-001',
      nameEn: 'Al Nakheel Tower',
      nameAr: 'برج النخيل',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<{ status: string }>().status).toBe('planned')
  })

  it('rejects a duplicate project code with 409', async () => {
    await api('POST', '/api/v1/projects', { code: 'DUP-1', nameEn: 'Alpha', nameAr: 'ألف' })
    const dup = await api('POST', '/api/v1/projects', {
      code: 'DUP-1',
      nameEn: 'Beta',
      nameAr: 'باء',
    })
    expect(dup.statusCode).toBe(409)
    expect(dup.json<{ code: string }>().code).toBe('PROJECT_CODE_TAKEN')
  })

  it('walks the status lifecycle and blocks illegal jumps', async () => {
    const { id } = (
      await api('POST', '/api/v1/projects', { code: 'LIF-1', nameEn: 'Lifecycle', nameAr: 'دورة' })
    ).json<{ id: string }>()

    // planned → delivered is not a thing.
    const jump = await api('POST', `/api/v1/projects/${id}/status`, { status: 'delivered' })
    expect(jump.statusCode).toBe(400)
    expect(jump.json<{ code: string }>().code).toBe('INVALID_STATUS_TRANSITION')

    expect(
      (await api('POST', `/api/v1/projects/${id}/status`, { status: 'in_progress' })).statusCode,
    ).toBe(200)

    // on_hold without a reason is refused; with one it succeeds.
    const holdNoReason = await api('POST', `/api/v1/projects/${id}/status`, { status: 'on_hold' })
    expect(holdNoReason.json<{ code: string }>().code).toBe('REASON_REQUIRED')
    expect(
      (
        await api('POST', `/api/v1/projects/${id}/status`, {
          status: 'on_hold',
          reason: 'Client payment delayed',
        })
      ).statusCode,
    ).toBe(200)
  })
})

describe('units and rooms', () => {
  /** Creates a project and a unit, returns both ids. */
  async function seedUnit(): Promise<{ projectId: string; unitId: string }> {
    const { id: projectId } = (
      await api('POST', '/api/v1/projects', { code: 'UNT-1', nameEn: 'Units', nameAr: 'وحدات' })
    ).json<{ id: string }>()
    const { id: unitId } = (
      await api('POST', `/api/v1/projects/${projectId}/units`, {
        unitNumber: '305',
        name: 'Unit 305',
        floor: 3,
        grossArea: '142.5',
        ceilingHeightMm: 3000,
      })
    ).json<{ id: string }>()
    return { projectId, unitId }
  }

  it('creates a unit and rejects a duplicate unit number in the same project', async () => {
    const { projectId } = await seedUnit()
    const dup = await api('POST', `/api/v1/projects/${projectId}/units`, {
      unitNumber: '305',
      name: 'Duplicate',
      grossArea: '100',
    })
    expect(dup.statusCode).toBe(409)
    expect(dup.json<{ code: string }>().code).toBe('UNIT_NUMBER_TAKEN')
  })

  it('adds a room and returns BOQ-ready geometry', async () => {
    const { unitId } = await seedUnit()
    const res = await api('POST', `/api/v1/units/${unitId}/rooms`, {
      typeCode: 'master_bedroom',
      nameEn: 'Master Bedroom',
      nameAr: 'غرفة النوم الرئيسية',
      widthMm: 4900,
      lengthMm: 5000,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{
      geometry: { floorArea: string; wallArea: string; perimeter: string }
    }>()
    // The exact numbers the BOQ rules will consume. docs/14 §4
    expect(body.geometry.floorArea).toBe('24.5000')
    expect(body.geometry.perimeter).toBe('19.8000')
    expect(body.geometry.wallArea).toBe('59.4000') // inherited 3000mm ceiling
  })

  it('rejects a room with centimetres mis-keyed as millimetres', async () => {
    const { unitId } = await seedUnit()
    const res = await api('POST', `/api/v1/units/${unitId}/rooms`, {
      typeCode: 'bathroom',
      nameEn: 'Bath',
      nameAr: 'حمام',
      widthMm: 250, // 25 cm "room"
      lengthMm: 3000,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('DIMENSION_OUT_OF_RANGE')
  })

  it('flags — without rejecting — room areas exceeding the gross area', async () => {
    const proj = (
      await api('POST', '/api/v1/projects', { code: 'OVR-1', nameEn: 'Overrun', nameAr: 'تجاوز' })
    ).json<{ id: string }>()
    const { id: unitId } = (
      await api('POST', `/api/v1/projects/${proj.id}/units`, {
        unitNumber: 'S-1',
        name: 'Small unit',
        grossArea: '20',
      })
    ).json<{ id: string }>()

    const res = await api('POST', `/api/v1/units/${unitId}/rooms`, {
      typeCode: 'living_room',
      nameEn: 'Living',
      nameAr: 'معيشة',
      widthMm: 5000,
      lengthMm: 5000, // 25 m² into a 20 m² unit
    })
    expect(res.statusCode).toBe(201) // accepted…
    expect(res.json<{ roomAreaExceedsGross: boolean }>().roomAreaExceedsGross).toBe(true) // …but flagged
  })

  it('reads a unit back with rooms sorted and geometry attached', async () => {
    const { unitId } = await seedUnit()
    await api('POST', `/api/v1/units/${unitId}/rooms`, {
      typeCode: 'kitchen',
      nameEn: 'Kitchen',
      nameAr: 'مطبخ',
      widthMm: 3000,
      lengthMm: 4000,
    })
    await api('POST', `/api/v1/units/${unitId}/rooms`, {
      typeCode: 'majlis',
      nameEn: 'Majlis',
      nameAr: 'مجلس',
      widthMm: 5000,
      lengthMm: 6000,
    })

    const res = await api('GET', `/api/v1/units/${unitId}`)
    const body = res.json<{ rooms: { typeCode: string; geometry: { floorArea: string } }[] }>()
    expect(body.rooms).toHaveLength(2)
    expect(body.rooms[0]!.typeCode).toBe('kitchen')
    expect(body.rooms[1]!.typeCode).toBe('majlis')
    expect(body.rooms[1]!.geometry.floorArea).toBe('30.0000')
  })
})

describe('tenant boundaries', () => {
  it("returns 404 — not 403 — for another tenant's unit", async () => {
    // Indistinguishable from "never existed": a 403 would confirm the id is
    // real, turning authorization into an information disclosure channel.
    const res = await api('GET', `/api/v1/units/${rivalUnitId}`)
    expect(res.statusCode).toBe(404)
  })

  it("cannot add a room to another tenant's unit", async () => {
    const res = await api('POST', `/api/v1/units/${rivalUnitId}/rooms`, {
      typeCode: 'bedroom',
      nameEn: 'X',
      nameAr: 'س',
      widthMm: 3000,
      lengthMm: 3000,
    })
    expect(res.statusCode).toBe(404)
  })

  it("never lists another tenant's projects", async () => {
    const res = await api('GET', '/api/v1/projects')
    const codes = res.json<{ data: { code: string }[] }>().data.map((p) => p.code)
    expect(codes).not.toContain('RVL-1')
  })
})
