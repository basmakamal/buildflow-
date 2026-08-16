import {
  AggregateRoot,
  type Clock,
  type CompanyId,
  type DomainError,
  type ProjectId,
  type Result,
  type RoomId,
  type UnitId,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import { Room, type RoomProps } from './room'

export type UnitStatus =
  'planned' | 'in_progress' | 'on_hold' | 'completed' | 'delivered' | 'cancelled'

export type HandoverCondition = 'red_brick' | 'semi_finished' | 'fully_finished_renovation'

/**
 * Unit — its own aggregate root, NOT a child of Project.
 *
 * A tower project holds 200 of these. If they lived inside the Project
 * aggregate, updating one unit would load hundreds of rows and every
 * concurrent site update would contend on one version column. The consistency
 * boundary is the unit — which is also the business rule: each unit is
 * tracked independently. docs/18 ADR-006
 *
 * Rooms DO live inside this aggregate: the invariants worth protecting
 * (room-count sanity, geometry-vs-plan ownership) span the unit and its rooms,
 * and a unit rarely exceeds ~20 rooms, so loading them together is cheap.
 */
export interface UnitSnapshot {
  id: UnitId
  companyId: CompanyId
  projectId: ProjectId
  ownerClientId: string | null
  unitNumber: string
  name: string
  floor: number | null
  grossArea: string
  ceilingHeightMm: number
  handoverCondition: HandoverCondition
  status: UnitStatus
  currency: string
  rooms: RoomProps[]
  version: number
}

/** A 400-room unit is a data-entry accident, not a building. */
const MAX_ROOMS = 60

export class Unit extends AggregateRoot<UnitId> {
  #rooms: Room[]
  #status: UnitStatus

  private constructor(
    id: UnitId,
    readonly companyId: CompanyId,
    readonly projectId: ProjectId,
    readonly ownerClientId: string | null,
    readonly unitNumber: string,
    readonly name: string,
    readonly floor: number | null,
    readonly grossArea: string,
    readonly ceilingHeightMm: number,
    readonly handoverCondition: HandoverCondition,
    readonly currency: string,
    status: UnitStatus,
    rooms: Room[],
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#rooms = rooms
  }

  static restore(snapshot: UnitSnapshot): Unit {
    return new Unit(
      snapshot.id,
      snapshot.companyId,
      snapshot.projectId,
      snapshot.ownerClientId,
      snapshot.unitNumber,
      snapshot.name,
      snapshot.floor,
      snapshot.grossArea,
      snapshot.ceilingHeightMm,
      snapshot.handoverCondition,
      snapshot.currency,
      snapshot.status,
      snapshot.rooms.map((r) => Room.restore(r)),
      snapshot.version,
    )
  }

  get status(): UnitStatus {
    return this.#status
  }
  get rooms(): readonly Room[] {
    return this.#rooms
  }

  /**
   * Adds a room, defaulting its height to the unit's ceiling height.
   *
   * The default matters more than it looks: an engineer adding eight rooms
   * types the height zero times instead of eight, and the one room that
   * genuinely differs (a dropped-ceiling bathroom) is an explicit override.
   */
  addRoom(
    props: Omit<RoomProps, 'isAreaFromPlan' | 'sortOrder' | 'heightMm' | 'typeCode'> & {
      typeCode: string
      heightMm?: number
    },
    actor: string,
    clock: Clock,
  ): Result<Room, DomainError> {
    if (this.#status === 'delivered' || this.#status === 'cancelled') {
      return err(
        validationError('UNIT_NOT_EDITABLE', `Cannot modify a ${this.#status} unit`, {
          status: this.#status,
        }),
      )
    }
    if (this.#rooms.length >= MAX_ROOMS) {
      return err(
        validationError('TOO_MANY_ROOMS', `A unit may not exceed ${MAX_ROOMS} rooms`, {
          max: MAX_ROOMS,
        }),
      )
    }

    const created = Room.create({
      ...props,
      heightMm: props.heightMm ?? this.ceilingHeightMm,
      sortOrder: this.#rooms.length,
    })
    if (created.isErr()) return created

    this.#rooms = [...this.#rooms, created.value]
    this.raise({
      eventId: crypto.randomUUID() as never,
      eventType: 'unit.room_added',
      occurredAt: clock.now(),
      companyId: this.companyId,
      actorId: actor as never,
      aggregateType: 'Unit',
      aggregateId: this.id,
      eventVersion: 1,
      payload: {
        unitId: this.id,
        roomId: created.value.id,
        typeCode: created.value.typeCode,
        floorArea: created.value.geometry().floorArea,
      },
    })
    return ok(created.value)
  }

  removeRoom(roomId: RoomId, actor: string, clock: Clock): Result<void, DomainError> {
    if (this.#status === 'delivered' || this.#status === 'cancelled') {
      return err(validationError('UNIT_NOT_EDITABLE', `Cannot modify a ${this.#status} unit`))
    }
    const room = this.#rooms.find((r) => r.id === roomId)
    if (!room) {
      return err(validationError('ROOM_NOT_FOUND', 'Room does not belong to this unit'))
    }
    if (room.isAreaFromPlan) {
      // The floor plan owns this geometry. Deleting the room here would leave
      // the plan referencing a ghost and the BOQ counting a room that "does
      // not exist" — the plan is where it must be removed. docs/01 ROM-02
      return err(
        validationError(
          'ROOM_OWNED_BY_PLAN',
          'This room is measured by the floor plan; remove it there',
        ),
      )
    }
    this.#rooms = this.#rooms.filter((r) => r.id !== roomId)
    this.raise({
      eventId: crypto.randomUUID() as never,
      eventType: 'unit.room_removed',
      occurredAt: clock.now(),
      companyId: this.companyId,
      actorId: actor as never,
      aggregateType: 'Unit',
      aggregateId: this.id,
      eventVersion: 1,
      payload: { unitId: this.id, roomId },
    })
    return ok()
  }

  /**
   * Total room floor area vs. the declared gross area — a WARNING signal, not
   * a rejection. Corridors, wall thickness and shafts make exact equality
   * unrealistic; a large excess means someone mis-keyed a dimension.
   * docs/02 §3.4
   */
  roomAreaExceedsGross(): boolean {
    const totalScaled = this.#rooms.reduce((sum, room) => {
      const [whole = '0', frac = '0000'] = room.geometry().floorArea.split('.')
      return sum + BigInt(whole + frac.padEnd(4, '0'))
    }, 0n)
    const [gw = '0', gf = '0000'] = this.grossArea.split('.')
    const grossScaled = BigInt(gw + gf.padEnd(4, '0'))
    return grossScaled > 0n && totalScaled > grossScaled
  }

  toSnapshot(): UnitSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      projectId: this.projectId,
      ownerClientId: this.ownerClientId,
      unitNumber: this.unitNumber,
      name: this.name,
      floor: this.floor,
      grossArea: this.grossArea,
      ceilingHeightMm: this.ceilingHeightMm,
      handoverCondition: this.handoverCondition,
      status: this.#status,
      currency: this.currency,
      rooms: this.#rooms.map((r) => ({
        id: r.id,
        typeCode: r.typeCode,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        widthMm: r.widthMm,
        lengthMm: r.lengthMm,
        heightMm: r.heightMm,
        isAreaFromPlan: r.isAreaFromPlan,
        sortOrder: r.sortOrder,
      })),
      version: this.version,
    }
  }
}
