import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_VIEWPORT } from '@buildflow/spatial'
import { usePlannerStore } from '@/stores/planner'

/**
 * Rooms in the store. docs/08 §7.4
 *
 * Two properties carry the sprint. Rooms are DERIVED, so they stay out of the
 * undo history — otherwise every wall edit would cost two Ctrl+Z presses. And
 * assignments are keyed by the walls that enclose a space, so the name a
 * person typed survives an edit that merely moves it.
 *
 * These run through the same `detectRooms` the worker calls: the client falls
 * back to the main thread where `Worker` does not exist, which is exactly what
 * makes this path assertable.
 */

const point = (x: number, y: number) => ({ x, y })

/** Four walls round a 6×4 room, drawn corner to corner as a user would. */
function drawRoom(store: ReturnType<typeof usePlannerStore>, width = 6000, height = 4000) {
  store.addWall(point(0, 0), point(width, 0))
  store.addWall(point(width, 0), point(width, height))
  store.addWall(point(width, height), point(0, height))
  store.addWall(point(0, height), point(0, 0))
}

describe('detecting rooms', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('finds the space a closed loop encloses', async () => {
    const store = usePlannerStore()
    drawRoom(store)

    await store.detectRooms()

    expect(store.rooms).toHaveLength(1)
    expect(store.rooms[0]?.areaMm2).toBe(24_000_000)
    expect(store.floorAreaMm2).toBe(24_000_000)
  })

  it('finds nothing while the loop is still open', async () => {
    const store = usePlannerStore()
    store.addWall(point(0, 0), point(6000, 0))
    store.addWall(point(6000, 0), point(6000, 4000))

    await store.detectRooms()

    expect(store.rooms).toEqual([])
  })

  it('stays OUT of the undo history', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    const steps = store.history.past.length

    await store.detectRooms()

    // Rooms are recomputed from walls the history already holds. Recording
    // them would cost two Ctrl+Z presses for every wall.
    expect(store.history.past.length).toBe(steps)
  })

  it('follows the walls when one is dragged', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()

    // Push the right-hand wall out to 7 m: two walls move with it.
    store.beginDrag('wall-1', 'end')
    store.endDrag(point(7000, 0))
    store.beginDrag('wall-2', 'start')
    store.endDrag(point(7000, 0))
    store.beginDrag('wall-2', 'end')
    store.endDrag(point(7000, 4000))
    store.beginDrag('wall-3', 'start')
    store.endDrag(point(7000, 4000))
    await store.detectRooms()

    expect(store.rooms[0]?.areaMm2).toBe(28_000_000)
  })

  it('drops the room when a wall is deleted', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()

    store.selection = new Set(['wall-1'])
    store.deleteSelected()
    await store.detectRooms()

    expect(store.rooms).toEqual([])
  })
})

describe('assigning a room', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('records the name and type, and undoes them', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()
    const signature = store.rooms[0]?.signature as string

    store.assignRoom(signature, { name: 'Majlis', typeCode: 'majlis' })

    expect(store.rooms[0]?.name).toBe('Majlis')
    expect(store.rooms[0]?.typeCode).toBe('majlis')
    // What a person typed cannot be recomputed, so it IS in the history.
    store.undo()
    expect(store.document.roomAssignments[signature]).toBeUndefined()
  })

  it('keeps the name through a geometry edit', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()
    store.assignRoom(store.rooms[0]?.signature as string, {
      name: 'Master bedroom',
      typeCode: 'master_bedroom',
    })

    store.beginDrag('wall-1', 'end')
    store.endDrag(point(7000, 0))
    store.beginDrag('wall-2', 'start')
    store.endDrag(point(7000, 0))
    await store.detectRooms()

    // The bounding walls are unchanged, so it is the same room — a room that
    // reverted to "Room 3" on every drag is a room nobody would name.
    expect(store.rooms[0]?.name).toBe('Master bedroom')
    expect(store.rooms[0]?.typeCode).toBe('master_bedroom')
  })

  it('does not carry a name across to a different space', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()
    store.assignRoom(store.rooms[0]?.signature as string, { name: 'Kitchen', typeCode: 'kitchen' })

    // A partition makes two new spaces, neither of which is the old one.
    store.addWall(point(2000, 0), point(2000, 4000))
    await store.detectRooms()

    expect(store.rooms).toHaveLength(2)
    expect(store.rooms.every((room) => room.name === '')).toBe(true)
  })

  it('lists what still has no type', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()

    expect(store.unnamedRooms).toHaveLength(1)
    store.assignRoom(store.rooms[0]?.signature as string, { typeCode: 'kitchen' })
    expect(store.unnamedRooms).toHaveLength(0)
  })
})

describe('the BOQ inputs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('derives floor, wall and ceiling from the geometry', async () => {
    const store = usePlannerStore()
    drawRoom(store)
    await store.detectRooms()

    const metrics = store.metricsFor(store.rooms[0]?.id as string)

    expect(metrics?.floorAreaMm2).toBe(24_000_000)
    expect(metrics?.ceilingAreaMm2).toBe(24_000_000)
    // 20 m of perimeter at the 3 m storey height the walls were drawn with.
    expect(metrics?.wallAreaMm2).toBe(20_000 * 3000)
  })

  it('stops the skirting at the doors, but not at the windows', async () => {
    const store = usePlannerStore()
    store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
    drawRoom(store)
    store.placeOpening(point(3000, 0), 'door')
    store.placeOpening(point(1000, 4000), 'window')
    await store.detectRooms()

    // docs/02 §3.7 — skirting runs past a window and stops at a doorway.
    expect(store.metricsFor(store.rooms[0]?.id as string)?.skirtingLengthMm).toBe(20_000 - 900)
  })

  it('has no metrics for a room that no longer exists', () => {
    const store = usePlannerStore()

    expect(store.metricsFor('room:nothing')).toBeNull()
  })
})
