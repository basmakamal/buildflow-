import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOOR_WIDTH_MM,
  MIN_OPENING_WIDTH_MM,
  centreOpeningAt,
  createOpening,
  moveOpening,
  openingBounds,
  openingCentre,
  openingHit,
  openingSegment,
  openingsOverlap,
  resizeOpening,
  type Opening,
} from '../src/domain/opening'
import { createWall, type Wall } from '../src/domain/wall'
import { point } from '../src/domain/geometry'

/**
 * An opening is HOSTED — it stores an offset along its wall, never a position.
 * These tests pin the consequences: the invariants from docs/02 §3.5 hold
 * against the host, and a door's plan position is DERIVED, so it follows a
 * wall that moves instead of being left behind in mid-air.
 */

const wall: Wall = createWall({
  id: 'north',
  start: point(0, 0),
  end: point(6000, 0),
  thicknessMm: 200,
}).unwrap()

const door = (offsetMm: number, widthMm = DEFAULT_DOOR_WIDTH_MM, id = 'o1'): Opening =>
  createOpening({ id, wallId: wall.id, kind: 'door', offsetMm, widthMm }, wall).unwrap()

describe('creating an opening', () => {
  it('fills in the regional defaults for its kind', () => {
    const window = createOpening(
      { id: 'w1', wallId: wall.id, kind: 'window', offsetMm: 1000 },
      wall,
    ).unwrap()

    expect(window.widthMm).toBe(1200)
    expect(window.sillMm).toBe(900)
    // A door's sill is zero by definition, not by default.
    expect(door(1000).sillMm).toBe(0)
  })

  it('refuses an opening that runs off the end of its wall', () => {
    const result = createOpening(
      { id: 'o', wallId: wall.id, kind: 'door', offsetMm: 5500, widthMm: 900 },
      wall,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('OPENING_OUTSIDE_WALL')
  })

  it('refuses one narrower than anybody builds', () => {
    const result = createOpening(
      { id: 'o', wallId: wall.id, kind: 'door', offsetMm: 0, widthMm: MIN_OPENING_WIDTH_MM - 1 },
      wall,
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('OPENING_TOO_NARROW')
  })

  it('refuses to overlap an opening already on the wall', () => {
    const existing = door(1000)
    const result = createOpening(
      { id: 'o2', wallId: wall.id, kind: 'window', offsetMm: 1500, widthMm: 1200 },
      wall,
      [existing],
    )

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('OPENING_OVERLAPS')
  })

  it('allows two openings jamb to jamb', () => {
    // Touching is not overlapping: a door beside a sidelight is ordinary.
    const first = door(1000, 900, 'a')
    const second = createOpening(
      { id: 'b', wallId: wall.id, kind: 'window', offsetMm: 1900, widthMm: 600 },
      wall,
      [first],
    )

    expect(second.isOk()).toBe(true)
    expect(openingsOverlap(first, second.unwrap())).toBe(false)
  })

  it('refuses an opening handed the wrong wall', () => {
    const other = createWall({ id: 'east', start: point(0, 0), end: point(0, 4000) }).unwrap()
    const result = createOpening({ id: 'o', wallId: 'north', kind: 'door', offsetMm: 0 }, other)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('OPENING_WALL_MISMATCH')
  })
})

describe('derived position', () => {
  it('places the opening along the host centreline', () => {
    const segment = openingSegment(wall, door(1000))

    expect(segment.start).toEqual({ x: 1000, y: 0 })
    expect(segment.end).toEqual({ x: 1900, y: 0 })
    expect(openingCentre(wall, door(1000))).toEqual({ x: 1450, y: 0 })
  })

  it('follows the wall rather than staying where it was drawn', () => {
    const opening = door(1000)
    // The same opening, on a wall that has since been rotated to run north.
    const turned = createWall({
      id: 'north',
      start: point(0, 0),
      end: point(0, 6000),
      thicknessMm: 200,
    }).unwrap()

    expect(openingSegment(turned, opening).start).toEqual({ x: 0, y: 1000 })
  })

  it('spans the wall thickness, so its bounds are never degenerate', () => {
    expect(openingBounds(wall, door(1000))).toEqual({
      minX: 1000,
      minY: -100,
      maxX: 1900,
      maxY: 100,
    })
  })

  it('is hit across the wall band, like the wall itself', () => {
    const opening = door(1000)

    expect(openingHit(wall, opening, point(1400, 80), 0)).toBe(true)
    expect(openingHit(wall, opening, point(3000, 0), 0)).toBe(false)
  })
})

describe('placing and editing', () => {
  it('centres an opening on the point clicked', () => {
    expect(centreOpeningAt(wall, point(3000, 40), 900)).toBe(2550)
  })

  it('clamps to the wall instead of refusing a click near the corner', () => {
    // Aiming a door at the very end means "as close to the corner as it goes".
    expect(centreOpeningAt(wall, point(5980, 0), 900)).toBe(5100)
    expect(centreOpeningAt(wall, point(-500, 0), 900)).toBe(0)
  })

  it('slides an opening, still checked against its neighbours', () => {
    const first = door(1000, 900, 'a')
    const second = door(3000, 900, 'b')

    expect(moveOpening(wall, second, 4000, [first]).isOk()).toBe(true)
    expect(moveOpening(wall, second, 1200, [first]).isErr()).toBe(true)
  })

  it('resizes about its own centre, which is how a jamb drag reads', () => {
    const widened = resizeOpening(wall, door(1000), 1500).unwrap()

    // Centre was 1450; it stays there while both jambs move outward.
    expect(widened.offsetMm).toBe(700)
    expect(widened.widthMm).toBe(1500)
  })

  it('refuses a resize that would push the opening off the wall', () => {
    expect(resizeOpening(wall, door(5000, 900), 3000).isErr()).toBe(true)
  })
})
