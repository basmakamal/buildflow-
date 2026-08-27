import {
  type DomainError,
  type Result,
  concurrencyError,
  conflictError,
  err,
  forbiddenError,
  ok,
  validationError,
} from '@buildflow/core'
import type { Background } from './background'
import type { PlanLayer } from './layers'
import type { Opening } from './opening'
import type { RoomAssignment } from './room'
import type { StructuralElement } from './structural'
import type { Wall } from './wall'

/**
 * The floor plan aggregate — what is saved, versioned and locked.
 * docs/02 §3.5, docs/04 §2.5, docs/08 §7.6
 *
 * Three concerns live here because they are the same concern: a plan is a
 * document that more than one person can open, so it needs an authoritative
 * VERSION (nobody's edits silently vanish), restorable REVISIONS (a bad
 * afternoon is recoverable), and a LOCK (two people cannot draw over each
 * other in the first place).
 *
 * Collaboration is advisory locking rather than CRDTs, per docs/08 §7.6. That
 * is a deliberate deferral: a CRDT is a large investment for a workflow where
 * two people rarely draw the same plan in the same minute, and a lock is
 * HONEST about what is happening rather than silently merging conflicting
 * geometry.
 */

export type PlanStatus = 'draft' | 'active' | 'archived'

/**
 * Everything that makes up a drawing. Deliberately the same shape the planner
 * store holds, so saving is a transfer rather than a translation — a mapping
 * layer between the editor and the wire is a place for the two to drift apart.
 */
export interface PlanGeometry {
  walls: Wall[]
  openings: Opening[]
  structural: StructuralElement[]
  layers: PlanLayer[]
  background: Background | null
  roomAssignments: Record<string, RoomAssignment>
}

export const emptyGeometry = (layers: PlanLayer[] = []): PlanGeometry => ({
  walls: [],
  openings: [],
  structural: [],
  layers,
  background: null,
  roomAssignments: {},
})

/**
 * An advisory edit lock with a TTL. docs/08 §7.6
 *
 * Two minutes, refreshed by heartbeat. Short enough that a closed laptop frees
 * the plan before anyone gives up waiting; long enough to survive a tunnel, a
 * sleeping tab, or a site engineer whose connection drops for a minute.
 */
export interface PlanLock {
  heldBy: string | null
  /** Shown to whoever is blocked. An id in that sentence helps nobody. */
  heldByName: string | null
  expiresAt: Date | null
}

export const LOCK_TTL_MS = 120_000

export const noLock = (): PlanLock => ({ heldBy: null, heldByName: null, expiresAt: null })

export interface FloorPlan {
  id: string
  unitId: string
  name: string
  status: PlanStatus
  geometry: PlanGeometry
  lock: PlanLock
  /** Optimistic concurrency. Rises on every accepted save. docs/07 §6 */
  version: number
}

export interface PlanRevision {
  id: string
  floorPlanId: string
  /** 1-based and gapless per plan — what a person refers to out loud. */
  revisionNumber: number
  name: string
  note: string | null
  snapshot: PlanGeometry
  createdBy: string
  createdAt: Date
}

// ── locking ─────────────────────────────────────────────────────────────────

/** Whether a lock is still in force at `now`. An expired lock holds nothing. */
export const lockIsLive = (lock: PlanLock, now: Date): boolean =>
  lock.heldBy !== null && lock.expiresAt !== null && lock.expiresAt.getTime() > now.getTime()

/** Who holds the plan right now, or null if it is free. */
export const lockHolder = (lock: PlanLock, now: Date): string | null =>
  lockIsLive(lock, now) ? lock.heldBy : null

/** Whether this user may edit — the single question the UI asks. */
export const canEdit = (lock: PlanLock, userId: string, now: Date): boolean => {
  const holder = lockHolder(lock, now)
  return holder === null || holder === userId
}

export interface LockRequest {
  userId: string
  userName: string
  now: Date
  ttlMs?: number
}

/**
 * Takes the editor's lock, or refreshes it if this user already holds it.
 *
 * Idempotent for the holder, so the heartbeat is the same call as the initial
 * acquire — one code path that is exercised every two minutes rather than a
 * refresh path that only runs in production.
 *
 * A lock that has EXPIRED is free for anyone: that is the takeover docs/08
 * §7.6 describes, and it needs no ceremony because the previous holder has
 * already stopped heartbeating.
 */
export function acquireLock(lock: PlanLock, request: LockRequest): Result<PlanLock, DomainError> {
  const holder = lockHolder(lock, request.now)
  if (holder !== null && holder !== request.userId) {
    return err(
      conflictError('PLAN_LOCKED', `The plan is being edited by ${lock.heldByName ?? holder}`, {
        heldBy: holder,
        heldByName: lock.heldByName ?? holder,
        expiresAt: lock.expiresAt?.toISOString() ?? '',
      }),
    )
  }

  return ok({
    heldBy: request.userId,
    heldByName: request.userName,
    expiresAt: new Date(request.now.getTime() + (request.ttlMs ?? LOCK_TTL_MS)),
  })
}

/**
 * Hands the plan back.
 *
 * Only the holder may release, and releasing a lock that has already expired
 * is a no-op rather than an error — the caller's intent ("I am done") is
 * satisfied either way, and failing there would make every editor closing late
 * show an error it can do nothing about.
 */
export function releaseLock(
  lock: PlanLock,
  userId: string,
  now: Date,
): Result<PlanLock, DomainError> {
  const holder = lockHolder(lock, now)
  if (holder !== null && holder !== userId) {
    return err(forbiddenError('PLAN_LOCK_NOT_YOURS', 'Only the lock holder can release it'))
  }
  return ok(noLock())
}

// ── saving ──────────────────────────────────────────────────────────────────

export interface SaveRequest {
  geometry: PlanGeometry
  /** The version the editor loaded. A mismatch means somebody else saved. */
  expectedVersion: number
  userId: string
  now: Date
}

/**
 * Accepts a new geometry, if the editor is still holding the lock and still
 * looking at the version it loaded.
 *
 * BOTH checks, not either: the lock stops two people editing at once, and the
 * version stops the rarer case the lock cannot — a tab that held the lock,
 * lost it to expiry, watched somebody else save, and then came back to life
 * with stale geometry. Without the version check that tab would overwrite
 * work it never saw. docs/07 §6
 */
export function savePlan(plan: FloorPlan, request: SaveRequest): Result<FloorPlan, DomainError> {
  if (!canEdit(plan.lock, request.userId, request.now)) {
    return err(
      conflictError(
        'PLAN_LOCKED',
        `The plan is being edited by ${plan.lock.heldByName ?? 'someone else'}`,
        {
          heldBy: plan.lock.heldBy ?? '',
          heldByName: plan.lock.heldByName ?? '',
        },
      ),
    )
  }
  if (request.expectedVersion !== plan.version) {
    return err(concurrencyError('FloorPlan', plan.id))
  }
  if (plan.status === 'archived') {
    return err(conflictError('PLAN_ARCHIVED', 'An archived plan cannot be edited'))
  }

  return ok({ ...plan, geometry: request.geometry, version: plan.version + 1 })
}

// ── revisions ───────────────────────────────────────────────────────────────

export interface RevisionRequest {
  id: string
  name: string
  note?: string | null
  userId: string
  now: Date
}

const MAX_REVISION_NAME = 120

/**
 * Freezes the CURRENT geometry under a name.
 *
 * A revision is a snapshot, not a diff: it must be restorable in isolation
 * years later, when the walls it referenced have been deleted and the chain of
 * diffs that would rebuild it no longer exists.
 */
export function createRevision(
  plan: FloorPlan,
  existing: readonly PlanRevision[],
  request: RevisionRequest,
): Result<PlanRevision, DomainError> {
  const name = request.name.trim()
  if (name.length === 0) {
    return err(validationError('REVISION_NAME_REQUIRED', 'A revision needs a name'))
  }
  if (name.length > MAX_REVISION_NAME) {
    return err(
      validationError(
        'REVISION_NAME_TOO_LONG',
        `A revision name is at most ${MAX_REVISION_NAME} characters`,
        {
          maximum: MAX_REVISION_NAME,
        },
      ),
    )
  }

  const highest = existing.reduce((top, revision) => Math.max(top, revision.revisionNumber), 0)
  return ok({
    id: request.id,
    floorPlanId: plan.id,
    revisionNumber: highest + 1,
    name,
    note: request.note?.trim() || null,
    // A structured clone, not a reference: later edits must not reach into a
    // snapshot that is supposed to be frozen, which is the whole point of
    // taking one. The store's geometry is Immer-frozen, but a plan arriving
    // from anywhere else is not.
    snapshot: structuredClone(plan.geometry),
    createdBy: request.userId,
    createdAt: request.now,
  })
}

/**
 * Restores a revision as a NEW state, not by rewinding.
 *
 * The plan's version still rises and the intervening revisions still exist, so
 * restoring is itself undoable. A restore that erased history would make the
 * feature too frightening to use, which is the same as not having it.
 */
export function restoreRevision(
  plan: FloorPlan,
  revision: PlanRevision,
  userId: string,
  now: Date,
): Result<FloorPlan, DomainError> {
  if (revision.floorPlanId !== plan.id) {
    return err(validationError('REVISION_WRONG_PLAN', 'That revision belongs to another plan'))
  }
  if (!canEdit(plan.lock, userId, now)) {
    return err(
      conflictError('PLAN_LOCKED', 'The plan is being edited by someone else', {
        heldBy: plan.lock.heldBy ?? '',
      }),
    )
  }

  return ok({ ...plan, geometry: revision.snapshot, version: plan.version + 1 })
}

/** How many objects a plan holds — the figure a revision list shows. */
export const geometrySize = (geometry: PlanGeometry): number =>
  geometry.walls.length + geometry.openings.length + geometry.structural.length
