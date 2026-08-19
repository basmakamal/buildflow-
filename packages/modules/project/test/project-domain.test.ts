import { describe, it, expect } from 'vitest'
import {
  FixedClock,
  type CompanyId,
  type ProjectId,
  type RoomId,
  type UnitId,
} from '@buildflow/core'
import { Project, PROJECT_TRANSITIONS, type ProjectStatus } from '../src/domain/project'
import { EMPTY_PROGRAMME, Unit } from '../src/domain/unit'
import { deriveGeometry, ROOM_TYPES } from '../src/domain/room'

const clock = new FixedClock(new Date('2026-08-16T08:00:00Z'))

const project = (status: ProjectStatus = 'planned'): Project =>
  Project.restore({
    id: 'prj-1' as ProjectId,
    companyId: 'co-1' as CompanyId,
    code: 'ACME-001',
    nameEn: 'Al Nakheel Tower',
    nameAr: 'برج النخيل',
    clientId: null,
    status,
    currency: 'SAR',
    holdReason: null,
    version: 0,
  })

const unit = (over: Partial<Parameters<typeof Unit.restore>[0]> = {}): Unit =>
  Unit.restore({
    id: 'unit-1' as UnitId,
    companyId: 'co-1' as CompanyId,
    projectId: 'prj-1' as ProjectId,
    ownerClientId: null,
    unitNumber: '305',
    name: 'Unit 305',
    floor: 3,
    grossArea: '142.5000',
    ceilingHeightMm: 3000,
    handoverCondition: 'red_brick',
    // Unrecorded by default, which is the state most units are actually in.
    programme: EMPTY_PROGRAMME,
    status: 'planned',
    currency: 'SAR',
    rooms: [],
    version: 0,
    ...over,
  })

describe('project status state machine', () => {
  it('follows the happy path to delivery', () => {
    const p = project()
    expect(p.changeStatus('in_progress', 'u1', clock).isOk()).toBe(true)
    expect(p.changeStatus('completed', 'u1', clock).isOk()).toBe(true)
    expect(p.changeStatus('delivered', 'u1', clock).isOk()).toBe(true)
    expect(p.status).toBe('delivered')
  })

  it('forbids un-delivering — history does not un-happen', () => {
    const p = project('delivered')
    for (const target of ['planned', 'in_progress', 'completed'] as const) {
      const result = p.changeStatus(target, 'u1', clock)
      expect(result.isErr() && result.error.code).toBe('INVALID_STATUS_TRANSITION')
    }
  })

  it('forbids skipping straight from planned to delivered', () => {
    const result = project().changeStatus('delivered', 'u1', clock)
    expect(result.isErr() && result.error.code).toBe('INVALID_STATUS_TRANSITION')
  })

  it('requires a reason to go on hold', () => {
    // "Why was this project stopped for six weeks?" is answered from the
    // record or not at all. docs/01 PRJ-04
    const p = project('in_progress')
    expect(p.changeStatus('on_hold', 'u1', clock).isErr()).toBe(true)
    expect(p.changeStatus('on_hold', 'u1', clock, '   ').isErr()).toBe(true)
    expect(p.changeStatus('on_hold', 'u1', clock, 'Client payment delayed').isOk()).toBe(true)
    expect(p.holdReason).toBe('Client payment delayed')
  })

  it('clears the hold reason on resume', () => {
    const p = project('in_progress')
    p.changeStatus('on_hold', 'u1', clock, 'Ramadan pause')
    p.changeStatus('in_progress', 'u1', clock)
    expect(p.holdReason).toBeNull()
  })

  it('allows reopening a completed project but never a delivered one', () => {
    expect(project('completed').changeStatus('in_progress', 'u1', clock).isOk()).toBe(true)
    expect(project('delivered').changeStatus('in_progress', 'u1', clock).isErr()).toBe(true)
  })

  it('raises an event carrying from, to and reason', () => {
    const p = project('in_progress')
    p.changeStatus('on_hold', 'u1', clock, 'Material shortage')
    const [event] = p.pullEvents()
    expect(event!.eventType).toBe('project.status_changed')
    expect(event!.payload).toMatchObject({
      from: 'in_progress',
      to: 'on_hold',
      reason: 'Material shortage',
    })
  })

  it('declares terminal states as terminal', () => {
    expect(PROJECT_TRANSITIONS.delivered).toHaveLength(0)
    expect(PROJECT_TRANSITIONS.cancelled).toHaveLength(0)
  })
})

describe('room geometry derivation', () => {
  it('derives the documented worked example', () => {
    // 4.9 m × 5.0 m × 3.0 m master bedroom → 24.5 m² floor — the number used
    // in the BOQ walk-through in docs/14 §4.
    const g = deriveGeometry(4900, 5000, 3000)
    expect(g.floorArea).toBe('24.5000')
    expect(g.ceilingArea).toBe('24.5000')
    expect(g.perimeter).toBe('19.8000')
    expect(g.wallArea).toBe('59.4000') // 19.8 × 3.0
  })

  it('is exact for dimensions that would drift as floats', () => {
    // 3333 × 3333 mm = 11108889 mm² = 11.108889 m² → 11.1089 at 4 dp.
    expect(deriveGeometry(3333, 3333, 2700).floorArea).toBe('11.1089')
  })

  it('derives identical geometry for identical inputs, always', () => {
    const a = deriveGeometry(4123, 3877, 2950)
    const b = deriveGeometry(4123, 3877, 2950)
    expect(a).toEqual(b)
  })
})

describe('unit rooms', () => {
  const roomProps = (over: Record<string, unknown> = {}) => ({
    id: `room-${String(Math.random()).slice(2, 8)}` as RoomId,
    typeCode: 'bedroom' as const,
    nameEn: 'Bedroom',
    nameAr: 'غرفة نوم',
    widthMm: 4000,
    lengthMm: 3500,
    ...over,
  })

  it('adds a room and inherits the unit ceiling height', () => {
    const u = unit({ ceilingHeightMm: 3200 })
    const result = u.addRoom(roomProps(), 'u1', clock)
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().heightMm).toBe(3200)
  })

  it('lets a room override the ceiling height explicitly', () => {
    const u = unit()
    const result = u.addRoom(roomProps({ heightMm: 2600 }), 'u1', clock)
    expect(result.unwrap().heightMm).toBe(2600)
  })

  it('rejects dimensions outside sanity bounds', () => {
    // 100 mm is a typo (cm entered as mm); catching it here beats generating
    // a BOQ for 0.1 m² of flooring.
    const u = unit()
    expect(u.addRoom(roomProps({ widthMm: 100 }), 'u1', clock).isErr()).toBe(true)
    expect(u.addRoom(roomProps({ lengthMm: 90_000 }), 'u1', clock).isErr()).toBe(true)
    expect(u.addRoom(roomProps({ widthMm: 4000.5 }), 'u1', clock).isErr()).toBe(true)
  })

  it('refuses to modify a delivered unit', () => {
    const u = unit({ status: 'delivered' })
    const result = u.addRoom(roomProps(), 'u1', clock)
    expect(result.isErr() && result.error.code).toBe('UNIT_NOT_EDITABLE')
  })

  it('refuses to remove a room owned by the floor plan', () => {
    const u = unit({
      rooms: [
        {
          id: 'room-plan' as RoomId,
          typeCode: 'kitchen',
          nameEn: 'Kitchen',
          nameAr: 'مطبخ',
          widthMm: 3000,
          lengthMm: 4000,
          heightMm: 3000,
          isAreaFromPlan: true,
          sortOrder: 0,
        },
      ],
    })
    const result = u.removeRoom('room-plan' as RoomId, 'u1', clock)
    expect(result.isErr() && result.error.code).toBe('ROOM_OWNED_BY_PLAN')
  })

  it('warns when room areas exceed the gross area', () => {
    const u = unit({ grossArea: '20.0000' })
    u.addRoom(roomProps({ widthMm: 5000, lengthMm: 5000 }), 'u1', clock) // 25 m² > 20 m²
    expect(u.roomAreaExceedsGross()).toBe(true)
  })

  it('does not warn within the gross area', () => {
    const u = unit({ grossArea: '142.5000' })
    u.addRoom(roomProps(), 'u1', clock) // 14 m²
    expect(u.roomAreaExceedsGross()).toBe(false)
  })

  it('includes the Gulf room programme', () => {
    // A room list that cannot express a مجلس cannot describe most villas in
    // the target market. docs/01 ROM-01
    expect(ROOM_TYPES).toContain('majlis')
    expect(ROOM_TYPES).toContain('maid_room')
    expect(ROOM_TYPES).toContain('driver_room')
  })
})
