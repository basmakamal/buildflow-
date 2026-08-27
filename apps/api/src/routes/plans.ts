import type { FastifyInstance } from 'fastify'
import { SystemClock, Uuid7Generator } from '@buildflow/core'
import {
  acquireLock,
  createRevision,
  createShare,
  publicScene,
  releaseLock,
  restoreRevision,
  revokeShare,
  savePlan,
  shareRefusal,
  type PlanGeometry,
  type RoomBoundary,
} from '@buildflow/spatial'
import {
  PrismaPlanRepository,
  PrismaShareRepository,
  newPlan,
} from '@buildflow/spatial/infrastructure'
import { generateRefreshToken, hashToken } from '@buildflow/identity'
import { runWithoutTenantScope } from '@buildflow/database'
import type { Database } from '@buildflow/database'
import type { Container } from '../container'
import { authenticate, principalOf, requirePermission } from '../plugins/authenticate'
import { problem, statusFor } from '../server'

/**
 * Floor plan routes. docs/04 §2.5, docs/08 §7.6
 *
 * Permissions ride on the UNIT rather than on a `plan.*` family of their own:
 * a floor plan is part of a unit, so whoever may edit the unit may draw it.
 * That is a deliberate simplification — splitting it later means adding
 * permissions to the catalogue AND re-seeding every tenant's roles, and there
 * is no case yet for someone who may edit a unit but not its plan.
 *
 * The lock is ADVISORY (docs/08 §7.6): it is enforced here on write, but it is
 * a coordination device, not a security boundary. Authorisation is the
 * permission check; the lock only stops two authorised people from drawing
 * over each other.
 */

const clock = new SystemClock()
const ids = new Uuid7Generator()

/**
 * Bodies as they arrive off the WIRE, which is to say: possibly not at all.
 *
 * Optional rather than required, because these routes carry no JSON schema and
 * a client can post anything. Declaring the fields as present would make the
 * guards below look dead to the type checker while doing nothing whatsoever to
 * the request that omits them.
 */
interface SaveBody {
  geometry?: PlanGeometry
  rooms?: RoomBoundary[]
  expectedVersion?: number
  name?: string
}

interface RevisionBody {
  name?: string
  note?: string
}

export function registerPlanRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const plans = new PrismaPlanRepository(db)
  const shares = new PrismaShareRepository(db)

  const NOT_FOUND = (id: unknown) => problem('NOT_FOUND', 'Resource not found', 404, id)

  /** The name shown to whoever is blocked by a lock. An id helps nobody. */
  async function displayName(userId: string): Promise<string> {
    const user = await db.user.findFirst({ where: { id: userId } })
    return user ? `${user.firstNameEn} ${user.lastNameEn}`.trim() : userId
  }

  // ── the plan itself ──────────────────────────────────────────────────────

  app.get<{ Params: { unitId: string } }>(
    '/api/v1/units/:unitId/plan',
    { preHandler: [authenticate(c), requirePermission('unit.view')] },
    async (request, reply) => {
      const plan = await plans.findByUnit(request.params.unitId)
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))
      return { data: plan }
    },
  )

  /**
   * Creates the unit's plan.
   *
   * Idempotent by unit: a second call returns the existing plan rather than a
   * second drawing of the same room. Two plans for one unit is not a state the
   * BOQ could make sense of, and the client races itself constantly — every
   * tab that opens the planner tries this.
   */
  app.post<{ Params: { unitId: string }; Body: { name?: string } | undefined }>(
    '/api/v1/units/:unitId/plan',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const unitId = request.params.unitId
      const existing = await plans.findByUnit(unitId)
      if (existing) return { data: existing }

      const principal = principalOf(request)
      const plan = newPlan(ids.next(), unitId, request.body?.name?.trim() || 'Floor plan')
      await plans.create(plan, principal.userId)

      return reply.status(201).send({ data: plan })
    },
  )

  /**
   * Saves the whole geometry.
   *
   * A full replace rather than a patch. docs/08 §7.5 proposes PATCH deltas for
   * autosave, and that is the right optimisation once plans are large — but a
   * delta protocol has to be correct about ordering and about what a client
   * missed, and a wrong delta silently corrupts a drawing. The full document
   * is a few hundred kilobytes; this stays whole until a measurement says it
   * cannot.
   */
  app.put<{ Params: { planId: string }; Body: SaveBody }>(
    '/api/v1/plans/:planId',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const plan = await plans.findById(request.params.planId)
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))

      const { geometry, expectedVersion } = request.body
      if (!geometry || typeof expectedVersion !== 'number') {
        return reply
          .status(400)
          .send(
            problem('PLAN_SAVE_MALFORMED', 'A save needs geometry and a version', 400, request.id),
          )
      }

      const principal = principalOf(request)
      const result = savePlan(plan, {
        geometry,
        expectedVersion,
        userId: principal.userId,
        now: clock.now(),
      })
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      const next = { ...result.value, name: request.body.name?.trim() || plan.name }
      const written = await plans.save(next, request.body.rooms ?? [])
      if (!written) {
        // The row moved between the read and the write — another save landed
        // in that window. The guard is in the UPDATE's WHERE clause, so this
        // is the honest answer rather than a silent overwrite.
        return reply
          .status(409)
          .send(
            problem(
              'CONCURRENT_MODIFICATION',
              'The plan was saved by someone else',
              409,
              request.id,
            ),
          )
      }

      return { data: { version: next.version } }
    },
  )

  // ── the advisory lock ────────────────────────────────────────────────────

  /**
   * Takes the editor's lock, or refreshes it. One call for both, so the path
   * the heartbeat exercises every two minutes is the same one that ran when
   * the plan opened.
   */
  app.post<{ Params: { planId: string } }>(
    '/api/v1/plans/:planId/lock',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const plan = await plans.findById(request.params.planId)
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const result = acquireLock(plan.lock, {
        userId: principal.userId,
        userName: await displayName(principal.userId),
        now: clock.now(),
      })
      if (result.isErr()) {
        return reply
          .status(409)
          .send(problem(result.error.code, result.error.message, 409, request.id))
      }

      await plans.updateLock(plan.id, result.value)
      return { data: result.value }
    },
  )

  app.delete<{ Params: { planId: string } }>(
    '/api/v1/plans/:planId/lock',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const plan = await plans.findById(request.params.planId)
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const result = releaseLock(plan.lock, principal.userId, clock.now())
      if (result.isErr()) {
        return reply
          .status(403)
          .send(problem(result.error.code, result.error.message, 403, request.id))
      }

      await plans.updateLock(plan.id, result.value)
      return { data: result.value }
    },
  )

  // ── client share links ───────────────────────────────────────────────────

  /**
   * Mints a link. The TOKEN is returned exactly once and never stored — only
   * its hash is, so a leaked database row does not open the plan it points at.
   * docs/11 §2.2
   */
  app.post<{ Params: { planId: string }; Body: { label?: string; days?: number } | undefined }>(
    '/api/v1/plans/:planId/shares',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const plan = await plans.findById(request.params.planId)
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const token = generateRefreshToken()
      const result = createShare({
        id: ids.next(),
        floorPlanId: plan.id,
        tokenHash: await hashToken(token),
        label: request.body?.label ?? '',
        ...(request.body?.days === undefined ? {} : { days: request.body.days }),
        createdBy: principal.userId,
        now: clock.now(),
      })
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      await shares.create(result.value, principal.companyId)
      const { tokenHash: _hash, ...summary } = result.value
      // The only response that will ever carry it.
      return reply.status(201).send({ data: { ...summary, token } })
    },
  )

  app.get<{ Params: { planId: string } }>(
    '/api/v1/plans/:planId/shares',
    { preHandler: [authenticate(c), requirePermission('unit.view')] },
    async (request) => {
      const rows = await shares.listForPlan(request.params.planId)
      // Without the hash: it is not the token, but it is the only thing
      // standing between a database read and a working link.
      return { data: rows.map(({ tokenHash: _hash, ...summary }) => summary) }
    },
  )

  app.delete<{ Params: { planId: string; shareId: string } }>(
    '/api/v1/plans/:planId/shares/:shareId',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const share = await shares.findById(request.params.shareId)
      if (!share || share.floorPlanId !== request.params.planId) {
        return reply.status(404).send(NOT_FOUND(request.id))
      }

      const result = revokeShare(share, clock.now())
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      await shares.revoke(share.id, clock.now())
      return { data: { revoked: true } }
    },
  )

  /**
   * THE ONE UNAUTHENTICATED ROUTE IN THIS PRODUCT.
   *
   * A client on a phone, holding a link, with no account. Three things follow
   * and none of them are optional:
   *
   *   · No `authenticate` and therefore no tenant in context, so the read runs
   *     through `runWithoutTenantScope` DELIBERATELY — the token establishes
   *     which tenant's plan this is, rather than a session asserting it.
   *   · The payload is built by `publicScene`, which redacts. A route cannot
   *     leak costs or a traced survey by returning the wrong object, because
   *     it never holds the whole object.
   *   · A refused link answers 410 with a REASON. "This expired on the 4th"
   *     and "the contractor withdrew this" are different things to tell a
   *     client, and a bare 404 tells them neither.
   */
  app.get<{ Params: { token: string } }>(
    '/api/v1/shared/plans/:token',
    {
      schema: {
        params: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', minLength: 20, maxLength: 128 } },
        },
      },
    },
    async (request, reply) => {
      const found = await runWithoutTenantScope(
        { userId: null, requestId: request.id, source: 'system', locale: 'en' },
        async () => shares.findByHash(await hashToken(request.params.token)),
      )
      if (!found) return reply.status(404).send(NOT_FOUND(request.id))

      const refusal = shareRefusal(found.share, clock.now())
      if (refusal) {
        return reply
          .status(410)
          .send(
            problem(`SHARE_${refusal.toUpperCase()}`, `This link is ${refusal}`, 410, request.id),
          )
      }

      const plan = await runWithoutTenantScope(
        { userId: null, requestId: request.id, source: 'system', locale: 'en' },
        () => plans.findById(found.share.floorPlanId),
      )
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))

      // Counted only once the link has actually opened: a refusal is not a view.
      await runWithoutTenantScope(
        { userId: null, requestId: request.id, source: 'system', locale: 'en' },
        () => shares.countView(found.share.id),
      )

      // Rooms are re-derived by the viewer from the geometry, exactly as the
      // editor does — so a stale room row cannot outlive the walls it came from.
      return { data: publicScene(plan.name, plan.geometry, []) }
    },
  )

  // ── revisions ────────────────────────────────────────────────────────────

  app.get<{ Params: { planId: string } }>(
    '/api/v1/plans/:planId/revisions',
    { preHandler: [authenticate(c), requirePermission('unit.view')] },
    async (request) => {
      const revisions = await plans.listRevisions(request.params.planId)
      // The snapshots are megabytes and the list only needs the labels.
      return {
        data: revisions.map(({ snapshot: _snapshot, ...summary }) => ({
          ...summary,
          objectCount:
            _snapshot.walls.length + _snapshot.openings.length + _snapshot.structural.length,
        })),
      }
    },
  )

  app.post<{ Params: { planId: string }; Body: RevisionBody | undefined }>(
    '/api/v1/plans/:planId/revisions',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const plan = await plans.findById(request.params.planId)
      if (!plan) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const existing = await plans.listRevisions(plan.id)
      const result = createRevision(plan, existing, {
        id: ids.next(),
        name: request.body?.name ?? '',
        note: request.body?.note ?? null,
        userId: principal.userId,
        now: clock.now(),
      })
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      await plans.addRevision(result.value)
      const { snapshot: _snapshot, ...summary } = result.value
      return reply.status(201).send({ data: summary })
    },
  )

  /**
   * Restores a revision as a NEW version rather than by rewinding: the
   * intervening revisions survive, so restoring is itself undoable. A restore
   * that erased history would be too frightening to use.
   */
  app.post<{ Params: { planId: string; revisionId: string } }>(
    '/api/v1/plans/:planId/revisions/:revisionId/restore',
    { preHandler: [authenticate(c), requirePermission('unit.update')] },
    async (request, reply) => {
      const plan = await plans.findById(request.params.planId)
      const revision = plan ? await plans.findRevision(plan.id, request.params.revisionId) : null
      if (!plan || !revision) return reply.status(404).send(NOT_FOUND(request.id))

      const principal = principalOf(request)
      const result = restoreRevision(plan, revision, principal.userId, clock.now())
      if (result.isErr()) {
        return reply
          .status(statusFor(result.error))
          .send(
            problem(result.error.code, result.error.message, statusFor(result.error), request.id),
          )
      }

      // Room boundaries are re-derived by the editor on load, so a restore
      // writes none: stale rooms would otherwise outlive the walls that
      // produced them.
      const written = await plans.save(result.value, [])
      if (!written) {
        return reply
          .status(409)
          .send(
            problem(
              'CONCURRENT_MODIFICATION',
              'The plan was saved by someone else',
              409,
              request.id,
            ),
          )
      }

      return { data: result.value }
    },
  )
}
