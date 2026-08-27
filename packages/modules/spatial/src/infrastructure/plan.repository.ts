import type { Database } from '@buildflow/database'
import { polygonCentroid, type Point } from '../domain/geometry'
import { isBeam, type StructuralElement } from '../domain/structural'
import type { Opening, OpeningKind } from '../domain/opening'
import type { RoomBoundary } from '../domain/room'
import type { Wall } from '../domain/wall'
import {
  emptyGeometry,
  noLock,
  type FloorPlan,
  type PlanGeometry,
  type PlanLock,
  type PlanRevision,
  type PlanStatus,
} from '../domain/plan'

/**
 * Prisma persistence for floor plans. docs/04 §2.5
 *
 * DUAL STORAGE, and the rule that keeps it honest: the normalised child rows
 * are the source of truth — queryable, and what the BOQ take-off reads — while
 * `geometry` is a CACHE so the editor loads a plan in one round trip instead
 * of five joins. Every save rewrites both inside ONE transaction, because a
 * cache that can disagree with its source is worse than no cache: it would be
 * the fast path, so it would be the one everybody reads.
 *
 * Tenant scoping is injected below this layer by the client extension, which
 * is why `companyId` never appears in a `where` here. docs/11 §4
 */

export interface PlanRepository {
  findByUnit(unitId: string): Promise<FloorPlan | null>
  findById(id: string): Promise<FloorPlan | null>
  create(plan: FloorPlan, createdBy: string): Promise<void>
  /** Writes geometry + rooms and bumps the version. Returns false if the version moved. */
  save(plan: FloorPlan, rooms: readonly RoomBoundary[]): Promise<boolean>
  updateLock(planId: string, lock: PlanLock): Promise<void>
  listRevisions(planId: string): Promise<PlanRevision[]>
  findRevision(planId: string, revisionId: string): Promise<PlanRevision | null>
  addRevision(revision: PlanRevision): Promise<void>
}

/** The JSON cache column, once it has been through the database and back. */
const geometryOf = (value: unknown): PlanGeometry => {
  const parsed = (value ?? {}) as Partial<PlanGeometry>
  return {
    walls: parsed.walls ?? [],
    openings: parsed.openings ?? [],
    structural: parsed.structural ?? [],
    layers: parsed.layers ?? [],
    background: parsed.background ?? null,
    roomAssignments: parsed.roomAssignments ?? {},
  }
}

interface PlanRow {
  id: string
  unitId: string
  name: string
  status: string
  geometry: unknown
  version: number
  lockedByUserId: string | null
  lockedByName: string | null
  lockExpiresAt: Date | null
}

const toDomain = (row: PlanRow): FloorPlan => ({
  id: row.id,
  unitId: row.unitId,
  name: row.name,
  status: row.status as PlanStatus,
  geometry: geometryOf(row.geometry),
  lock: {
    heldBy: row.lockedByUserId,
    heldByName: row.lockedByName,
    expiresAt: row.lockExpiresAt,
  },
  version: row.version,
})

/** docs/04 §2.5 models arches and niches; the planner draws two of the four. */
const OPENING_TYPE: Record<OpeningKind, 'door' | 'window'> = { door: 'door', window: 'window' }

export class PrismaPlanRepository implements PlanRepository {
  constructor(private readonly db: Database) {}

  async findByUnit(unitId: string): Promise<FloorPlan | null> {
    const row = await this.db.floorPlan.findFirst({
      where: { unitId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return row ? toDomain(row) : null
  }

  async findById(id: string): Promise<FloorPlan | null> {
    const row = await this.db.floorPlan.findFirst({ where: { id, deletedAt: null } })
    return row ? toDomain(row) : null
  }

  async create(plan: FloorPlan, createdBy: string): Promise<void> {
    await this.db.floorPlan.create({
      data: {
        id: plan.id,
        unitId: plan.unitId,
        name: plan.name,
        status: plan.status,
        geometry: plan.geometry as never,
        version: plan.version,
        createdBy,
      } as never,
    })
  }

  /**
   * Rewrites the whole plan.
   *
   * Delete-and-reinsert rather than a diff. A wall's row carries nothing the
   * client does not send — no server-generated state to preserve — so a diff
   * would buy nothing but a class of bugs where a stale row survives an edit
   * that should have removed it. The whole write is one transaction, so a
   * failure halfway leaves the previous plan intact rather than a half-erased
   * one.
   *
   * The version guard is in the WHERE clause, not in a read-then-write: two
   * saves racing must not both see version 4 and both succeed.
   */
  async save(plan: FloorPlan, rooms: readonly RoomBoundary[]): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const claimed = await tx.floorPlan.updateMany({
        // `plan.version` has already been incremented by the domain, so the row
        // must still be at the version the editor loaded.
        where: { id: plan.id, version: plan.version - 1 },
        data: {
          geometry: plan.geometry as never,
          name: plan.name,
          status: plan.status,
          version: plan.version,
        },
      })
      if (claimed.count === 0) return false

      await tx.planOpening.deleteMany({ where: { floorPlanId: plan.id } })
      await tx.planWall.deleteMany({ where: { floorPlanId: plan.id } })
      await tx.planStructuralElement.deleteMany({ where: { floorPlanId: plan.id } })
      await tx.planRoomBoundary.deleteMany({ where: { floorPlanId: plan.id } })

      await tx.planWall.createMany({ data: plan.geometry.walls.map(wallRow(plan.id)) as never })
      await tx.planOpening.createMany({
        data: plan.geometry.openings.map(openingRow(plan.id)) as never,
      })
      await tx.planStructuralElement.createMany({
        data: plan.geometry.structural.map(structuralRow(plan.id)) as never,
      })
      await tx.planRoomBoundary.createMany({ data: rooms.map(roomRow(plan.id)) as never })

      return true
    })
  }

  /**
   * Lock changes bypass the version entirely.
   *
   * A heartbeat every two minutes must not invalidate the geometry version the
   * open editor is holding — bumping it would make the next save fail for a
   * conflict that never happened.
   */
  async updateLock(planId: string, lock: PlanLock): Promise<void> {
    await this.db.floorPlan.updateMany({
      where: { id: planId },
      data: {
        lockedByUserId: lock.heldBy,
        lockedByName: lock.heldByName,
        lockExpiresAt: lock.expiresAt,
      },
    })
  }

  async listRevisions(planId: string): Promise<PlanRevision[]> {
    const rows = await this.db.planRevision.findMany({
      where: { floorPlanId: planId },
      orderBy: { revisionNumber: 'desc' },
    })
    return rows.map((row) => ({
      id: row.id,
      floorPlanId: row.floorPlanId,
      revisionNumber: row.revisionNumber,
      name: row.name,
      note: row.note,
      snapshot: geometryOf(row.snapshot),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }))
  }

  async findRevision(planId: string, revisionId: string): Promise<PlanRevision | null> {
    const rows = await this.listRevisions(planId)
    return rows.find((revision) => revision.id === revisionId) ?? null
  }

  async addRevision(revision: PlanRevision): Promise<void> {
    await this.db.planRevision.create({
      data: {
        id: revision.id,
        floorPlanId: revision.floorPlanId,
        revisionNumber: revision.revisionNumber,
        name: revision.name,
        note: revision.note,
        snapshot: revision.snapshot as never,
        createdBy: revision.createdBy,
        createdAt: revision.createdAt,
      } as never,
    })
  }
}

/** An empty plan for a unit that has never had one. */
export const newPlan = (id: string, unitId: string, name: string): FloorPlan => ({
  id,
  unitId,
  name,
  status: 'draft',
  geometry: emptyGeometry(),
  lock: noLock(),
  version: 1,
})

// ── row mapping ─────────────────────────────────────────────────────────────
// Curried by plan id so each mapper stays a one-argument function the callers
// above can hand straight to `map`.

const wallRow = (floorPlanId: string) => (wall: Wall, index: number) => ({
  id: wall.id,
  floorPlanId,
  startXMm: wall.start.x,
  startYMm: wall.start.y,
  endXMm: wall.end.x,
  endYMm: wall.end.y,
  thicknessMm: wall.thicknessMm,
  heightMm: wall.heightMm,
  layer: wall.layer,
  // Draw order decides which wall a click takes where two overlap, so it is
  // persisted rather than left to whatever order rows come back in.
  sortOrder: index,
})

const openingRow = (floorPlanId: string) => (opening: Opening) => ({
  id: opening.id,
  floorPlanId,
  wallId: opening.wallId,
  type: OPENING_TYPE[opening.kind],
  offsetMm: opening.offsetMm,
  widthMm: opening.widthMm,
  heightMm: opening.heightMm,
  sillHeightMm: opening.sillMm,
})

const structuralRow = (floorPlanId: string) => (element: StructuralElement) => {
  const shared = {
    id: element.id,
    floorPlanId,
    type: element.kind,
    widthMm: element.widthMm,
    layer: element.layer,
  }

  if (isBeam(element)) {
    return {
      ...shared,
      xMm: element.start.x,
      yMm: element.start.y,
      endXMm: element.end.x,
      endYMm: element.end.y,
      depthMm: element.depthMm,
      rotationDeg: 0,
    }
  }

  return {
    ...shared,
    xMm: element.centre.x,
    yMm: element.centre.y,
    endXMm: null,
    endYMm: null,
    depthMm: element.depthMm,
    heightMm: element.heightMm,
    rotationDeg: Math.round(element.rotationDeg),
  }
}

const roomRow = (floorPlanId: string) => (room: RoomBoundary) => {
  const centroid: Point = polygonCentroid(room.polygon)
  return {
    id: room.id.replaceAll(':', '-').slice(0, 36),
    floorPlanId,
    signature: room.signature.slice(0, 1000),
    name: room.name,
    typeCode: room.typeCode,
    polygon: room.polygon as never,
    // Square millimetres are what the plan holds; square METRES are what a BOQ
    // line is priced in, and the conversion belongs at this boundary.
    computedArea: room.areaMm2 / 1_000_000,
    computedPerimeter: room.perimeterMm / 1000,
    centroidXMm: centroid.x,
    centroidYMm: centroid.y,
    ceilingHeightMm: room.ceilingHeightMm,
  }
}
