import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CEILING_HEIGHT_MM,
  reconcileRooms,
  roomAt,
  roomMetrics,
  roomIdFor,
  totalFloorAreaMm2,
  unassignedRooms,
  type RoomBoundary,
} from '../src/domain/room'
import type { DetectedRoom } from '../src/domain/room-detection'
import { point } from '../src/domain/geometry'

/**
 * Detection produces geometry; this adds the two things only a person can
 * supply — a name and a type — and the property worth protecting is that they
 * SURVIVE re-detection. A room that reverts to "Room 3" every time somebody
 * drags a corner is a room nobody will bother naming.
 */

const face = (signature: string, wallIds: string[], areaMm2: number): DetectedRoom => ({
  signature,
  wallIds,
  areaMm2,
  perimeterMm: 20_000,
  holeIds: [],
  polygon: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000)],
})

describe('metrics', () => {
  const room = { areaMm2: 24_000_000, perimeterMm: 20_000, ceilingHeightMm: 3000 }

  it('derives exactly what the quantity rules consume', () => {
    const metrics = roomMetrics(room)

    expect(metrics.floorAreaMm2).toBe(24_000_000)
    expect(metrics.ceilingAreaMm2).toBe(24_000_000)
    expect(metrics.wallAreaMm2).toBe(20_000 * 3000)
    expect(metrics.volumeMm3).toBe(24_000_000 * 3000)
  })

  it('stops the skirting at every doorway', () => {
    // docs/02 §3.7: skirting = perimeter − Σ(door.width).
    expect(roomMetrics(room, [900, 800]).skirtingLengthMm).toBe(20_000 - 1700)
  })

  it('never returns a negative skirting run', () => {
    // A tiny lobby that is mostly doors would otherwise bill a negative length.
    expect(roomMetrics(room, [30_000]).skirtingLengthMm).toBe(0)
  })
})

describe('reconciling a fresh detection', () => {
  const assignments = {
    'w1|w2|w3|w4': {
      name: 'Master bedroom',
      typeCode: 'master_bedroom',
      ceilingHeightMm: 2800,
    },
  }

  it('keeps the name and type through a geometry edit', () => {
    // The same four walls, a metre longer.
    const [room] = reconcileRooms(
      [face('w1|w2|w3|w4', ['w1', 'w2', 'w3', 'w4'], 28_000_000)],
      assignments,
    )

    expect(room?.id).toBe(roomIdFor('w1|w2|w3|w4'))
    expect(room?.name).toBe('Master bedroom')
    expect(room?.typeCode).toBe('master_bedroom')
    expect(room?.ceilingHeightMm).toBe(2800)
    // …while the geometry follows the walls.
    expect(room?.areaMm2).toBe(28_000_000)
  })

  it('gives a genuinely new space no assumptions', () => {
    const [room] = reconcileRooms([face('w5|w6|w7|w8', ['w5', 'w6', 'w7', 'w8'], 9_000_000)], {})

    expect(room?.name).toBe('')
    expect(room?.typeCode).toBeNull()
    expect(room?.ceilingHeightMm).toBe(DEFAULT_CEILING_HEIGHT_MM)
  })

  it('drops a room the walls no longer enclose', () => {
    // Carrying it forward would leave a named space with an area nothing on
    // the drawing supports — and it would still reach the BOQ.
    expect(reconcileRooms([], assignments)).toEqual([])
  })

  it('derives an id from the signature, so it survives a reload', () => {
    const first = reconcileRooms([face('a|b|c', ['a', 'b', 'c'], 1_000_000)], {})
    const second = reconcileRooms([face('a|b|c', ['a', 'b', 'c'], 1_000_000)], {})

    expect(first[0]?.id).toBe(second[0]?.id)
  })

  it('honours a project ceiling height where the user has not chosen one', () => {
    const rooms = reconcileRooms([face('a', ['a'], 1)], assignments, { ceilingHeightMm: 3200 })

    expect(rooms[0]?.ceilingHeightMm).toBe(3200)
  })
})

describe('finding and totalling', () => {
  const plate: RoomBoundary = {
    id: 'plate',
    signature: 'outer',
    typeCode: 'living_room',
    name: 'Living',
    polygon: [point(0, 0), point(10_000, 0), point(10_000, 10_000), point(0, 10_000)],
    areaMm2: 96_000_000,
    perimeterMm: 48_000,
    wallIds: [],
    ceilingHeightMm: 3000,
  }
  const shaft: RoomBoundary = {
    ...plate,
    id: 'shaft',
    signature: 'inner',
    typeCode: null,
    name: '',
    polygon: [point(4000, 4000), point(6000, 4000), point(6000, 6000), point(4000, 6000)],
    areaMm2: 4_000_000,
  }

  it('takes the SMALLEST room containing the point', () => {
    // The shaft is inside both polygons, and it is what the user clicked.
    expect(roomAt([plate, shaft], point(5000, 5000))?.id).toBe('shaft')
    expect(roomAt([plate, shaft], point(1000, 1000))?.id).toBe('plate')
    expect(roomAt([plate, shaft], point(50_000, 50_000))).toBeNull()
  })

  it('totals the floor area for the check against the unit', () => {
    expect(totalFloorAreaMm2([plate, shaft])).toBe(100_000_000)
  })

  it('lists what nobody has named yet', () => {
    expect(unassignedRooms([plate, shaft]).map((room) => room.id)).toEqual(['shaft'])
  })
})
