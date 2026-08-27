import type { FloorPlan, PlanGeometry, PlanLock, RoomBoundary } from '@buildflow/spatial'
import { request, type ApiResult } from './client'

/**
 * Floor plan endpoints. docs/04 §2.5, docs/08 §7.6
 *
 * A thin transport layer on purpose: it converts dates and nothing else. Every
 * rule about who may save and what a stale version means lives on the server,
 * where it cannot be edited by whoever is holding the browser.
 */

/** A revision without its snapshot — the list would be megabytes otherwise. */
export interface RevisionSummary {
  id: string
  revisionNumber: number
  name: string
  note: string | null
  createdBy: string
  createdAt: string
  objectCount: number
}

/** JSON has no Date, so the lock's expiry arrives as a string. */
interface WireLock {
  heldBy: string | null
  heldByName: string | null
  expiresAt: string | null
}

interface WirePlan extends Omit<FloorPlan, 'lock'> {
  lock: WireLock
}

const reviveLock = (lock: WireLock): PlanLock => ({
  heldBy: lock.heldBy,
  heldByName: lock.heldByName,
  expiresAt: lock.expiresAt ? new Date(lock.expiresAt) : null,
})

const revivePlan = (plan: WirePlan): FloorPlan => ({ ...plan, lock: reviveLock(plan.lock) })

const unwrap = <T, U>(result: ApiResult<{ data: T }>, revive: (value: T) => U): ApiResult<U> =>
  result.ok ? { ok: true, data: revive(result.data.data) } : result

export async function fetchPlan(unitId: string): Promise<ApiResult<FloorPlan>> {
  return unwrap(await request<{ data: WirePlan }>(`/units/${unitId}/plan`), revivePlan)
}

/** Idempotent by unit — a second call returns the plan the first one made. */
export async function createPlan(unitId: string, name?: string): Promise<ApiResult<FloorPlan>> {
  return unwrap(
    await request<{ data: WirePlan }>(`/units/${unitId}/plan`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
    revivePlan,
  )
}

export async function savePlanGeometry(
  planId: string,
  body: { geometry: PlanGeometry; rooms: RoomBoundary[]; expectedVersion: number },
): Promise<ApiResult<{ version: number }>> {
  return unwrap(
    await request<{ data: { version: number } }>(`/plans/${planId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    (value) => value,
  )
}

/** Acquire and heartbeat are the same call — see docs/08 §7.6. */
export async function takeLock(planId: string): Promise<ApiResult<PlanLock>> {
  return unwrap(
    await request<{ data: WireLock }>(`/plans/${planId}/lock`, { method: 'POST' }),
    reviveLock,
  )
}

export async function dropLock(planId: string): Promise<ApiResult<PlanLock>> {
  return unwrap(
    await request<{ data: WireLock }>(`/plans/${planId}/lock`, { method: 'DELETE' }),
    reviveLock,
  )
}

export async function fetchRevisions(planId: string): Promise<ApiResult<RevisionSummary[]>> {
  return unwrap(
    await request<{ data: RevisionSummary[] }>(`/plans/${planId}/revisions`),
    (value) => value,
  )
}

export async function createPlanRevision(
  planId: string,
  body: { name: string; note?: string },
): Promise<ApiResult<RevisionSummary>> {
  return unwrap(
    await request<{ data: RevisionSummary }>(`/plans/${planId}/revisions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    (value) => value,
  )
}

export async function restorePlanRevision(
  planId: string,
  revisionId: string,
): Promise<ApiResult<FloorPlan>> {
  return unwrap(
    await request<{ data: WirePlan }>(`/plans/${planId}/revisions/${revisionId}/restore`, {
      method: 'POST',
    }),
    revivePlan,
  )
}
