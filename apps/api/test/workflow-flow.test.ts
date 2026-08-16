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
 * The daily loop, end to end: instantiate the 14-stage workflow, walk a stage
 * through engineer-completes → manager-approves, and watch unit progress move.
 *
 * The two assertions that matter most:
 *  • the ENGINEER's token cannot approve, and the MANAGER cannot approve a
 *    stage they completed themselves — segregation of duty over real HTTP;
 *  • the transition log accumulates append-only rows for every move.
 */

const ids = new Uuid7Generator()
const raw = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } })
const db = bindTenantContext(withTenantScope(raw))

const COMPANY = ids.next<'CompanyId'>()
const PASSWORD = 'a-correct-horse-battery-staple-passphrase'

let app: FastifyInstance
let engineerToken: string
let managerToken: string
let unitId: string
let roleIds: Record<string, string>

const sys = { userId: null, requestId: 'seed', source: 'system' as const, locale: 'en' }

const as =
  (token: string) => (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
    const options: InjectOptions = { method, url, headers: { authorization: `Bearer ${token}` } }
    if (payload !== undefined) options.payload = payload as never
    return app.inject(options)
  }

async function makeUser(
  role: string,
  assignments: { scopeType: 'project'; scopeId: string }[] = [],
) {
  const hash = await new Argon2PasswordHasher().hash(PASSWORD)
  const email = `${role}-${String(Date.now())}-${Math.floor(performance.now() * 1000)}@acme.sa`
  const userId = ids.next()
  await runWithoutTenantScope(sys, async () => {
    await raw.user.create({
      data: {
        id: userId,
        companyId: COMPANY,
        email,
        passwordHash: hash,
        firstNameEn: 'T',
        lastNameEn: 'U',
        status: 'active',
      },
    })
    await raw.userRole.create({ data: { userId, roleId: roleIds[role]!, companyId: COMPANY } })
    for (const a of assignments) {
      await raw.userAssignment.create({
        data: {
          id: ids.next(),
          companyId: COMPANY,
          userId,
          scopeType: a.scopeType,
          scopeId: a.scopeId,
        },
      })
    }
  })
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { companyId: COMPANY, email, password: PASSWORD },
  })
  return res.json<{ accessToken: string }>().accessToken
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
  await runWithoutTenantScope(sys, async () => {
    await raw.stageTransition.deleteMany({})
    await raw.unitStage.deleteMany({})
    await raw.unitWorkflow.deleteMany({})
    await raw.workflowStageTemplate.deleteMany({})
    await raw.workflowTemplate.deleteMany({})
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

    await raw.company.create({
      data: {
        id: COMPANY,
        nameEn: 'Acme',
        nameAr: 'أكمي',
        slug: `acme-${String(Date.now())}`,
        countryCode: 'SA',
        defaultCurrency: 'SAR',
      },
    })
  })

  await seedPermissionCatalogue(db, () => ids.next())
  roleIds = await runWithoutTenantScope(sys, () => seedCompanyRoles(db, COMPANY, () => ids.next()))

  const projectId = ids.next()
  unitId = ids.next()
  await runWithoutTenantScope(sys, async () => {
    await raw.project.create({
      data: {
        id: projectId,
        companyId: COMPANY,
        code: 'WF-1',
        nameEn: 'Workflow Tower',
        nameAr: 'برج',
        currency: 'SAR',
        status: 'in_progress',
      },
    })
    await raw.unit.create({
      data: {
        id: unitId,
        companyId: COMPANY,
        projectId,
        unitNumber: '305',
        name: 'Unit 305',
        grossArea: '142.5',
        currency: 'SAR',
      },
    })
  })

  engineerToken = await makeUser('site_engineer', [{ scopeType: 'project', scopeId: projectId }])
  managerToken = await makeUser('project_manager')
})

describe('workflow instantiation', () => {
  it('instantiates the default 14-stage template on a unit', async () => {
    const res = await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    expect(res.statusCode).toBe(201)
    expect(res.json<{ stageCount: number }>().stageCount).toBe(14)
  })

  it('refuses a second workflow on the same unit', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const again = await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    expect(again.statusCode).toBe(409)
  })

  it('lists the board in sequence with zero progress', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const res = await as(engineerToken)('GET', `/api/v1/units/${unitId}/stages`)
    const body = res.json<{ progress: string; stages: { code: string; sequence: number }[] }>()
    expect(body.progress).toBe('0.00')
    expect(body.stages).toHaveLength(14)
    expect(body.stages[0]!.code).toBe('unit_received')
    expect(body.stages.map((s) => s.sequence)).toEqual([...Array(14).keys()].map((i) => i + 1))
  })
})

describe('the daily loop', () => {
  async function board() {
    const res = await as(engineerToken)('GET', `/api/v1/units/${unitId}/stages`)
    return res.json<{
      progress: string
      status: string
      stages: { id: string; code: string; status: string; progress: string }[]
    }>()
  }

  it('engineer works a stage, manager approves it, unit progress moves', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const plumbing = (await board()).stages.find((s) => s.code === 'plumbing')!

    const engineer = as(engineerToken)
    expect(
      (await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)).statusCode,
    ).toBe(200)
    expect(
      (
        await engineer('PATCH', `/api/v1/units/${unitId}/stages/${plumbing.id}/progress`, {
          progress: '60',
        })
      ).statusCode,
    ).toBe(200)

    const afterProgress = await board()
    // plumbing w9 of 100 total weight at 60% → 5.4% of the unit
    expect(afterProgress.progress).toBe('5.40')

    expect(
      (await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/complete`)).statusCode,
    ).toBe(200)

    const approved = await as(managerToken)(
      'POST',
      `/api/v1/units/${unitId}/stages/${plumbing.id}/approve`,
    )
    expect(approved.statusCode).toBe(200)
    expect((await board()).stages.find((s) => s.code === 'plumbing')!.status).toBe('approved')
    expect((await board()).progress).toBe('9.00') // full 9/100 weight

    // The unit row's denormalised progress moved with it.
    const unit = await runWithoutTenantScope(sys, () =>
      raw.unit.findFirst({ where: { id: unitId } }),
    )
    expect(String(unit!.progressPercentage)).toBe('9')
  })

  it('an engineer cannot approve at all — route permission', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const plumbing = (await board()).stages.find((s) => s.code === 'plumbing')!
    const engineer = as(engineerToken)
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/complete`)

    const res = await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/approve`)
    expect(res.statusCode).toBe(403)
  })

  it('a manager cannot approve a stage they completed — segregation of duty', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const plumbing = (await board()).stages.find((s) => s.code === 'plumbing')!
    const manager = as(managerToken)
    await manager('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)
    await manager('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/complete`)

    const res = await manager('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/approve`)
    expect(res.statusCode).toBe(403)
    expect(res.json<{ code: string }>().code).toBe('SELF_APPROVAL')
  })

  it('rejection sends the stage back to rework with the reason recorded', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const plumbing = (await board()).stages.find((s) => s.code === 'plumbing')!
    const engineer = as(engineerToken)
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/complete`)

    const rejected = await as(managerToken)(
      'POST',
      `/api/v1/units/${unitId}/stages/${plumbing.id}/reject`,
      { reason: 'Pressure test failed at riser 2' },
    )
    expect(rejected.statusCode).toBe(200)

    const state = (await board()).stages.find((s) => s.code === 'plumbing')!
    expect(state.status).toBe('rejected')

    // …and the engineer restarts the same stage.
    expect(
      (await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)).statusCode,
    ).toBe(200)
  })

  it('blocking requires a reason and shows on the board', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const plumbing = (await board()).stages.find((s) => s.code === 'plumbing')!
    const engineer = as(engineerToken)
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)

    const noReason = await engineer(
      'POST',
      `/api/v1/units/${unitId}/stages/${plumbing.id}/block`,
      {},
    )
    expect(noReason.statusCode).toBe(400) // schema requires it

    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/block`, {
      reason: 'No pipes delivered',
    })
    const state = (await board()).stages.find((s) => s.code === 'plumbing')!
    expect(state.status).toBe('blocked')
  })

  it('writes an append-only transition row for every move', async () => {
    await as(managerToken)('POST', `/api/v1/units/${unitId}/workflow`)
    const plumbing = (await board()).stages.find((s) => s.code === 'plumbing')!
    const engineer = as(engineerToken)
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/start`)
    await engineer('PATCH', `/api/v1/units/${unitId}/stages/${plumbing.id}/progress`, {
      progress: '40',
    })
    await engineer('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/complete`)
    await as(managerToken)('POST', `/api/v1/units/${unitId}/stages/${plumbing.id}/approve`)

    const transitions = await runWithoutTenantScope(sys, () =>
      raw.stageTransition.findMany({
        where: { unitStageId: plumbing.id },
        orderBy: { occurredAt: 'asc' },
      }),
    )
    expect(transitions.length).toBe(4)
    expect(transitions.map((t) => t.toStatus)).toEqual([
      'in_progress',
      'in_progress',
      'completed',
      'approved',
    ])
    // Different actors on complete vs approve — the SoD trail.
    expect(transitions[2]!.actorUserId).not.toBe(transitions[3]!.actorUserId)
  })
})
