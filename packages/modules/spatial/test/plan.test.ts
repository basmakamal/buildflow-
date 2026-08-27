import { describe, expect, it } from 'vitest'
import {
  LOCK_TTL_MS,
  acquireLock,
  canEdit,
  createRevision,
  emptyGeometry,
  lockHolder,
  noLock,
  releaseLock,
  restoreRevision,
  savePlan,
  type FloorPlan,
  type PlanRevision,
} from '../src/domain/plan'
import { createWall } from '../src/domain/wall'
import { point } from '../src/domain/geometry'

/**
 * Advisory locking and optimistic versioning. docs/08 §7.6, docs/07 §6
 *
 * The lock stops two people drawing over each other. The VERSION catches the
 * case a lock cannot: a tab that held the lock, lost it to expiry, watched
 * somebody else save, and came back to life with stale geometry. Without both,
 * somebody's afternoon disappears without any error being raised anywhere.
 */

const NOW = new Date('2026-08-26T09:00:00.000Z')
const later = (ms: number) => new Date(NOW.getTime() + ms)

const wall = createWall({ id: 'w1', start: point(0, 0), end: point(6000, 0) }).unwrap()

const plan = (overrides: Partial<FloorPlan> = {}): FloorPlan => ({
  id: 'plan-1',
  unitId: 'unit-1',
  name: 'Ground floor',
  status: 'draft',
  geometry: emptyGeometry(),
  lock: noLock(),
  version: 3,
  ...overrides,
})

describe('taking the lock', () => {
  it('gives a free plan to whoever asks', () => {
    const lock = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()

    expect(lock.heldBy).toBe('sara')
    expect(lock.expiresAt?.getTime()).toBe(NOW.getTime() + LOCK_TTL_MS)
  })

  it('refuses a second editor while the lock is live', () => {
    const held = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()
    const result = acquireLock(held, { userId: 'omar', userName: 'Omar', now: later(1000) })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('PLAN_LOCKED')
      // The person who is blocked needs a NAME, not an id.
      expect(result.error.params?.['heldByName']).toBe('Sara')
    }
  })

  it('is idempotent for the holder, so the heartbeat is the same call', () => {
    const held = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()
    const refreshed = acquireLock(held, {
      userId: 'sara',
      userName: 'Sara',
      now: later(60_000),
    }).unwrap()

    expect(refreshed.heldBy).toBe('sara')
    expect(refreshed.expiresAt?.getTime()).toBe(NOW.getTime() + 60_000 + LOCK_TTL_MS)
  })

  it('lets anyone take over once the holder stops heartbeating', () => {
    const abandoned = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()
    const after = later(LOCK_TTL_MS + 1)

    expect(lockHolder(abandoned, after)).toBeNull()
    expect(acquireLock(abandoned, { userId: 'omar', userName: 'Omar', now: after }).isOk()).toBe(
      true,
    )
  })

  it('answers the one question the UI asks', () => {
    const held = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()

    expect(canEdit(held, 'sara', NOW)).toBe(true)
    expect(canEdit(held, 'omar', NOW)).toBe(false)
    expect(canEdit(held, 'omar', later(LOCK_TTL_MS + 1))).toBe(true)
  })
})

describe('releasing the lock', () => {
  const held = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()

  it('frees the plan for the next editor', () => {
    expect(releaseLock(held, 'sara', NOW).unwrap().heldBy).toBeNull()
  })

  it('refuses a release by somebody who never held it', () => {
    const result = releaseLock(held, 'omar', NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PLAN_LOCK_NOT_YOURS')
  })

  it('accepts a late release rather than erroring at a closing editor', () => {
    // The lock already expired. "I am done" is satisfied either way, and an
    // error here is one nobody can act on.
    expect(releaseLock(held, 'sara', later(LOCK_TTL_MS + 1)).isOk()).toBe(true)
  })
})

describe('saving', () => {
  const geometry = { ...emptyGeometry(), walls: [wall] }

  it('accepts the holder at the version they loaded', () => {
    const held = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()
    const saved = savePlan(plan({ lock: held }), {
      geometry,
      expectedVersion: 3,
      userId: 'sara',
      now: NOW,
    }).unwrap()

    expect(saved.geometry.walls).toHaveLength(1)
    expect(saved.version).toBe(4)
  })

  it('accepts a save on an unlocked plan', () => {
    expect(
      savePlan(plan(), { geometry, expectedVersion: 3, userId: 'sara', now: NOW }).isOk(),
    ).toBe(true)
  })

  it('refuses somebody who does not hold the lock', () => {
    const held = acquireLock(noLock(), { userId: 'sara', userName: 'Sara', now: NOW }).unwrap()
    const result = savePlan(plan({ lock: held }), {
      geometry,
      expectedVersion: 3,
      userId: 'omar',
      now: NOW,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PLAN_LOCKED')
  })

  it('refuses a stale version even from the lock holder', () => {
    // The tab held the lock, lost it to expiry, somebody else saved, and it
    // came back to life. Without this it would overwrite work it never saw.
    const result = savePlan(plan({ version: 5 }), {
      geometry,
      expectedVersion: 3,
      userId: 'sara',
      now: NOW,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('CONCURRENT_MODIFICATION')
  })

  it('refuses to edit an archived plan', () => {
    const result = savePlan(plan({ status: 'archived' }), {
      geometry,
      expectedVersion: 3,
      userId: 'sara',
      now: NOW,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PLAN_ARCHIVED')
  })
})

describe('revisions', () => {
  // Built fresh per call: one of these tests mutates the plan on purpose, and
  // a shared fixture would carry that into the next test.
  const drawnPlan = () => plan({ geometry: { ...emptyGeometry(), walls: [wall] } })

  const revise = (existing: PlanRevision[], name = 'Before the client meeting', on = drawnPlan()) =>
    createRevision(on, existing, { id: 'rev-1', name, userId: 'sara', now: NOW })

  it('numbers from one, gaplessly', () => {
    const first = revise([]).unwrap()
    const second = createRevision(drawnPlan(), [first], {
      id: 'rev-2',
      name: 'After',
      userId: 'sara',
      now: NOW,
    }).unwrap()

    expect(first.revisionNumber).toBe(1)
    expect(second.revisionNumber).toBe(2)
  })

  it('freezes a COPY, so later edits cannot reach into it', () => {
    const editable = drawnPlan()
    const revision = revise([], 'Snapshot', editable).unwrap()
    // The plan carries on being edited.
    editable.geometry.walls.push(
      createWall({ id: 'w2', start: point(0, 0), end: point(0, 4000) }).unwrap(),
    )

    expect(revision.snapshot.walls).toHaveLength(1)
  })

  it('insists on a name, because a list of numbers is not a history', () => {
    expect(revise([], '   ').isErr()).toBe(true)
  })

  it('restores as a NEW version rather than by rewinding', () => {
    const revision = revise([]).unwrap()
    const current = plan({ geometry: emptyGeometry(), version: 9 })

    const restored = restoreRevision(current, revision, 'sara', NOW).unwrap()

    expect(restored.geometry.walls).toHaveLength(1)
    // Restoring is itself undoable — a restore that erased history would be
    // too frightening to use, which is the same as not having it.
    expect(restored.version).toBe(10)
  })

  it('refuses a revision belonging to another plan', () => {
    const foreign = { ...revise([]).unwrap(), floorPlanId: 'plan-2' }
    const result = restoreRevision(plan(), foreign, 'sara', NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('REVISION_WRONG_PLAN')
  })

  it('refuses to restore over somebody else editing', () => {
    const held = acquireLock(noLock(), { userId: 'omar', userName: 'Omar', now: NOW }).unwrap()
    const result = restoreRevision(plan({ lock: held }), revise([]).unwrap(), 'sara', NOW)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('PLAN_LOCKED')
  })
})
