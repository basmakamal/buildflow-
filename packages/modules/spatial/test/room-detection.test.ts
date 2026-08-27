import { describe, expect, it } from 'vitest'
import { detectRooms } from '../src/domain/room-detection'
import { createWall, type Wall } from '../src/domain/wall'
import { point } from '../src/domain/geometry'

/**
 * Room detection is where integer millimetres (docs/18 ADR-016) pay for
 * themselves: "is this loop closed" is a question about node identity, not
 * about tolerances, so a room cannot intermittently vanish from the BOQ
 * because two corners landed a fraction of a millimetre apart.
 *
 * The failure these tests are really guarding against is the silent one — a
 * room that is not detected produces no error anywhere, just a smaller
 * quantity on a document a client signs.
 */

let sequence = 0
const wall = (x1: number, y1: number, x2: number, y2: number): Wall => {
  sequence += 1
  return createWall({
    id: `w${sequence}`,
    start: point(x1, y1),
    end: point(x2, y2),
  }).unwrap()
}

/** A closed rectangle, drawn corner to corner as a user would. */
const rectangle = (x: number, y: number, width: number, height: number): Wall[] => [
  wall(x, y, x + width, y),
  wall(x + width, y, x + width, y + height),
  wall(x + width, y + height, x, y + height),
  wall(x, y + height, x, y),
]

const SIX_BY_FOUR_MM2 = 6000 * 4000

describe('a single closed room', () => {
  it('finds it, with the area the walls enclose', () => {
    const rooms = detectRooms(rectangle(0, 0, 6000, 4000))

    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.areaMm2).toBe(SIX_BY_FOUR_MM2)
    expect(rooms[0]?.perimeterMm).toBe(20_000)
  })

  it('discards the outside, which has exactly the same area', () => {
    // The unbounded face cannot be told from the room by size — only by the
    // direction the walk went round it.
    expect(detectRooms(rectangle(0, 0, 6000, 4000))).toHaveLength(1)
  })

  it('measures the centreline, whichever way the walls were drawn', () => {
    // The same rectangle, drawn anticlockwise instead.
    const anticlockwise = [
      wall(0, 0, 0, 4000),
      wall(0, 4000, 6000, 4000),
      wall(6000, 4000, 6000, 0),
      wall(6000, 0, 0, 0),
    ]

    expect(detectRooms(anticlockwise)[0]?.areaMm2).toBe(SIX_BY_FOUR_MM2)
  })

  it('names the walls that bound it', () => {
    const walls = rectangle(0, 0, 6000, 4000)
    const room = detectRooms(walls)[0]

    expect(room?.wallIds.sort()).toEqual(walls.map((item) => item.id).sort())
  })
})

describe('what is not a room', () => {
  it('finds nothing in an open loop', () => {
    // Three sides of a rectangle. A user who has not closed the corner has no
    // room yet, and inventing one would put a wrong area on a quotation.
    const open = rectangle(0, 0, 6000, 4000).slice(0, 3)

    expect(detectRooms(open)).toEqual([])
  })

  it('finds nothing where a corner is left a whole metre open', () => {
    const walls = [
      wall(0, 0, 6000, 0),
      wall(6000, 0, 6000, 4000),
      wall(6000, 4000, 0, 4000),
      wall(0, 4000, 0, 1000),
    ]

    expect(detectRooms(walls)).toEqual([])
  })

  it('ignores a stub sticking into a room', () => {
    // A half-drawn partition is traversed in both directions inside the same
    // face and contributes no area, so it neither breaks detection nor changes
    // the answer.
    const walls = [...rectangle(0, 0, 6000, 4000), wall(3000, 0, 3000, 1500)]
    const rooms = detectRooms(walls)

    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.areaMm2).toBe(SIX_BY_FOUR_MM2)
  })

  it('ignores a loop too small to be a space', () => {
    expect(detectRooms(rectangle(0, 0, 200, 200))).toEqual([])
  })
})

describe('several rooms', () => {
  it('splits a rectangle into two along a partition', () => {
    const walls = [
      ...rectangle(0, 0, 6000, 4000),
      // A partition from the top edge to the bottom, 2 m from the left.
      wall(2000, 0, 2000, 4000),
    ]
    const rooms = detectRooms(walls)

    expect(rooms).toHaveLength(2)
    expect(rooms.map((room) => room.areaMm2)).toEqual([4000 * 4000, 2000 * 4000])
  })

  it('finds an L-shaped room as one space, not two', () => {
    const walls = [
      wall(0, 0, 6000, 0),
      wall(6000, 0, 6000, 2000),
      wall(6000, 2000, 3000, 2000),
      wall(3000, 2000, 3000, 4000),
      wall(3000, 4000, 0, 4000),
      wall(0, 4000, 0, 0),
    ]
    const rooms = detectRooms(walls)

    expect(rooms).toHaveLength(1)
    // 6×2 across the top plus 3×2 below it.
    expect(rooms[0]?.areaMm2).toBe(6000 * 2000 + 3000 * 2000)
  })

  it('finds two rooms that do not touch', () => {
    const rooms = detectRooms([...rectangle(0, 0, 6000, 4000), ...rectangle(10_000, 0, 3000, 3000)])

    expect(rooms.map((room) => room.areaMm2)).toEqual([SIX_BY_FOUR_MM2, 9_000_000])
  })

  it('takes a shaft out of the floor plate that contains it', () => {
    // The two loops share no wall, so the graph sees two components and cannot
    // know one is inside the other. Left alone, that bills floor tiles across
    // a hole in the floor.
    const rooms = detectRooms([
      ...rectangle(0, 0, 10_000, 10_000),
      ...rectangle(4000, 4000, 2000, 2000),
    ])

    expect(rooms).toHaveLength(2)
    expect(rooms[0]?.areaMm2).toBe(100_000_000 - 4_000_000)
    expect(rooms[1]?.areaMm2).toBe(4_000_000)
    // Skirting runs around the shaft too, so the perimeter GROWS.
    expect(rooms[0]?.perimeterMm).toBe(40_000 + 8000)
    expect(rooms[0]?.holeIds).toEqual([rooms[1]?.signature])
  })

  it('never subtracts a room from the space it merely divides', () => {
    // Two halves of one rectangle share the partition, so they are siblings in
    // one component — not one inside the other.
    const rooms = detectRooms([...rectangle(0, 0, 6000, 4000), wall(2000, 0, 2000, 4000)])

    expect(rooms.map((room) => room.areaMm2)).toEqual([16_000_000, 8_000_000])
    expect(rooms.every((room) => room.holeIds.length === 0)).toBe(true)
  })
})

describe('near-coincident corners', () => {
  it('closes a loop whose corner was drawn twice, a millimetre apart', () => {
    // Exactly what tracing a survey by hand produces — and an open loop is a
    // room that silently disappears from the BOQ.
    const walls = [
      wall(0, 0, 6000, 0),
      wall(6001, 1, 6000, 4000),
      wall(6000, 4000, 0, 4000),
      wall(0, 4000, 0, 0),
    ]

    expect(detectRooms(walls)).toHaveLength(1)
  })

  it('leaves a gap wider than the tolerance open', () => {
    const walls = [
      wall(0, 0, 6000, 0),
      wall(6050, 0, 6000, 4000),
      wall(6000, 4000, 0, 4000),
      wall(0, 4000, 0, 0),
    ]

    expect(detectRooms(walls, { toleranceMm: 5 })).toEqual([])
  })
})

describe('the signature', () => {
  it('survives a corner being dragged, because the walls are unchanged', () => {
    const walls = rectangle(0, 0, 6000, 4000)
    const before = detectRooms(walls)[0]?.signature

    // The same four walls, with one corner moved out to 7 m.
    const stretched = walls.map((item) =>
      item.end.x === 6000 || item.start.x === 6000
        ? {
            ...item,
            start: item.start.x === 6000 ? point(7000, item.start.y) : item.start,
            end: item.end.x === 6000 ? point(7000, item.end.y) : item.end,
          }
        : item,
    )
    const after = detectRooms(stretched)[0]

    expect(after?.signature).toBe(before)
    // …and the area follows the geometry, as it must.
    expect(after?.areaMm2).toBe(7000 * 4000)
  })

  it('changes when a partition splits the space in two', () => {
    const walls = rectangle(0, 0, 6000, 4000)
    const before = detectRooms(walls)[0]?.signature
    const after = detectRooms([...walls, wall(2000, 0, 2000, 4000)])

    expect(after.map((room) => room.signature)).not.toContain(before)
  })
})
