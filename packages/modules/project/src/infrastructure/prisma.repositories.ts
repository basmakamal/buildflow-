import type { Database } from '@buildflow/database'
import type { CompanyId, ProjectId, RoomId, UnitId } from '@buildflow/core'
import { Project, type ProjectSnapshot } from '../domain/project'
import { Unit, type UnitSnapshot } from '../domain/unit'
import type { RoomType } from '../domain/room'
import { deriveGeometry } from '../domain/room'

/**
 * Prisma persistence for the project module.
 *
 * Tenant scoping is injected below this layer by the client extension; ABAC
 * scoping (which projects a user may see) is applied HERE, in the queries,
 * because it is per-request data the extension cannot know. The two layers are
 * deliberately separate: tenancy is absolute, assignment is contextual.
 */

export interface ProjectRepository {
  findById(id: ProjectId): Promise<Project | null>
  codeExists(code: string): Promise<boolean>
  create(snapshot: ProjectSnapshot): Promise<void>
  save(project: Project): Promise<void>
}

export interface UnitRepository {
  findById(id: UnitId): Promise<Unit | null>
  unitNumberExists(projectId: ProjectId, unitNumber: string): Promise<boolean>
  create(snapshot: UnitSnapshot): Promise<void>
  save(unit: Unit): Promise<void>
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database) {}

  async findById(id: ProjectId): Promise<Project | null> {
    const row = await this.db.project.findFirst({ where: { id, deletedAt: null } })
    if (!row) return null
    return Project.restore({
      id: row.id as ProjectId,
      companyId: row.companyId as CompanyId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      clientId: null,
      status: row.status,
      currency: row.currency,
      holdReason: null,
      version: row.version,
    })
  }

  async codeExists(code: string): Promise<boolean> {
    return (await this.db.project.count({ where: { code } })) > 0
  }

  async create(snapshot: ProjectSnapshot): Promise<void> {
    await this.db.project.create({
      data: {
        id: snapshot.id,
        code: snapshot.code,
        nameEn: snapshot.nameEn,
        nameAr: snapshot.nameAr,
        status: snapshot.status,
        currency: snapshot.currency,
      } as never,
    })
  }

  async save(project: Project): Promise<void> {
    const snapshot = project.toSnapshot()
    const result = await this.db.project.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: { status: snapshot.status, version: { increment: 1 } },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of Project ${snapshot.id}`)
    }
  }
}

export class PrismaUnitRepository implements UnitRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UnitId): Promise<Unit | null> {
    const row = await this.db.unit.findFirst({
      where: { id, deletedAt: null },
      include: { rooms: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    })
    if (!row) return null
    return Unit.restore({
      id: row.id as UnitId,
      companyId: row.companyId as CompanyId,
      projectId: row.projectId as ProjectId,
      ownerClientId: row.ownerClientId,
      unitNumber: row.unitNumber,
      name: row.name,
      floor: row.floor,
      grossArea: String(row.grossArea),
      // ceilingHeight is stored in metres (Decimal 6,3); the domain works in mm.
      ceilingHeightMm: Math.round(Number(row.ceilingHeight) * 1000),
      handoverCondition: row.handoverCondition,
      status: row.status,
      currency: row.currency,
      rooms: row.rooms.map((r) => ({
        id: r.id as RoomId,
        typeCode: r.typeCode as RoomType,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        widthMm: r.widthMm,
        lengthMm: r.lengthMm,
        heightMm: r.heightMm,
        isAreaFromPlan: r.isAreaFromPlan,
        sortOrder: r.sortOrder,
      })),
      version: row.version,
    })
  }

  async unitNumberExists(projectId: ProjectId, unitNumber: string): Promise<boolean> {
    return (await this.db.unit.count({ where: { projectId, unitNumber } })) > 0
  }

  async create(snapshot: UnitSnapshot): Promise<void> {
    await this.db.unit.create({
      data: {
        id: snapshot.id,
        projectId: snapshot.projectId,
        ownerClientId: snapshot.ownerClientId,
        unitNumber: snapshot.unitNumber,
        name: snapshot.name,
        floor: snapshot.floor,
        grossArea: snapshot.grossArea,
        ceilingHeight: (snapshot.ceilingHeightMm / 1000).toFixed(3),
        handoverCondition: snapshot.handoverCondition,
        status: snapshot.status,
        currency: snapshot.currency,
      } as never,
    })
  }

  /**
   * Persists the aggregate: optimistic-locked unit row, then a room diff.
   *
   * Rooms are diffed rather than delete-all-recreate because room ids are
   * referenced from outside the aggregate (finish specs, BOQ lines, photos) —
   * recreating them would orphan every reference on each save.
   */
  async save(unit: Unit): Promise<void> {
    const snapshot = unit.toSnapshot()

    const result = await this.db.unit.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: { status: snapshot.status, version: { increment: 1 } },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of Unit ${snapshot.id}`)
    }

    const existing = await this.db.room.findMany({
      where: { unitId: snapshot.id, deletedAt: null },
      select: { id: true },
    })
    const existingIds = new Set(existing.map((r) => r.id))
    const desiredIds = new Set<string>(snapshot.rooms.map((r) => r.id))

    const removed = [...existingIds].filter((id) => !desiredIds.has(id))
    if (removed.length > 0) {
      // Soft delete: photos and finish specs may still reference the room, and
      // "what did this room used to be?" is an audit question.
      await this.db.room.updateMany({
        where: { id: { in: removed } },
        data: { deletedAt: new Date() },
      })
    }

    for (const room of snapshot.rooms) {
      if (existingIds.has(room.id)) continue
      const geometry = deriveGeometry(room.widthMm, room.lengthMm, room.heightMm)
      await this.db.room.create({
        data: {
          id: room.id,
          unitId: snapshot.id,
          typeCode: room.typeCode,
          nameEn: room.nameEn,
          nameAr: room.nameAr,
          widthMm: room.widthMm,
          lengthMm: room.lengthMm,
          heightMm: room.heightMm,
          floorArea: geometry.floorArea,
          wallArea: geometry.wallArea,
          ceilingArea: geometry.ceilingArea,
          perimeter: geometry.perimeter,
          isAreaFromPlan: room.isAreaFromPlan,
          sortOrder: room.sortOrder,
        } as never,
      })
    }
  }
}

/**
 * Read-side queries, ABAC-scoped.
 *
 * `projectIds === null` means unrestricted; `[]` means assigned to nothing and
 * MUST return an empty page. Conflating those two turns a scoping bug into a
 * data leak, which is why the type forces the caller to decide. docs/11 §3.1
 */
export class ProjectQueries {
  constructor(private readonly db: Database) {}

  async listProjects(scope: string[] | null) {
    if (scope !== null && scope.length === 0) return []
    return this.db.project.findMany({
      where: { deletedAt: null, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        status: true,
        currency: true,
        progressPercentage: true,
        createdAt: true,
      },
    })
  }

  async listUnits(projectId: ProjectId, scope: string[] | null) {
    if (scope !== null && scope.length === 0) return []
    if (scope !== null && !scope.includes(projectId)) return []
    return this.db.unit.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { unitNumber: 'asc' },
      take: 200,
      select: {
        id: true,
        unitNumber: true,
        name: true,
        floor: true,
        grossArea: true,
        status: true,
        progressPercentage: true,
        handoverCondition: true,
        _count: { select: { rooms: { where: { deletedAt: null } } } },
      },
    })
  }
}
