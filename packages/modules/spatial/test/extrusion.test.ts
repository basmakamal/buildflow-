import { describe, expect, it } from 'vitest'
import { extrudePlan, solidCount, wallPanels } from '../src/domain/extrusion'
import { createWall, type Wall } from '../src/domain/wall'
import { createOpening, type Opening } from '../src/domain/opening'
import { createColumn, createBeam } from '../src/domain/structural'
import { emptyGeometry, type PlanGeometry } from '../src/domain/plan'
import { defaultLayers } from '../src/domain/layers'
import type { RoomBoundary } from '../src/domain/room'
import { point } from '../src/domain/geometry'

/**
 * The 3D pipeline, without a renderer. docs/08 §8.1
 *
 * Openings are cut by DECOMPOSITION rather than by a boolean, so what these
 * tests really check is that the pieces left around a door add up to the wall
 * that was there before it — no gap over the head, no sliver under the sill,
 * nothing left standing in the doorway. A lintel a few millimetres out is
 * invisible in a screenshot and obvious to anyone who walks through the door.
 */

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, heightMm = 3000): Wall =>
  createWall({
    id,
    start: point(x1, y1),
    end: point(x2, y2),
    thicknessMm: 200,
    heightMm,
  }).unwrap()

const NORTH = wall('w1', 0, 0, 6000, 0)

const opening = (
  kind: 'door' | 'window',
  offsetMm: number,
  widthMm: number,
  host: Wall = NORTH,
): Opening =>
  createOpening(
    { id: `${kind}-${offsetMm}`, wallId: host.id, kind, offsetMm, widthMm },
    host,
  ).unwrap()

const geometryOf = (partial: Partial<PlanGeometry>): PlanGeometry => ({
  ...emptyGeometry(defaultLayers()),
  ...partial,
})

const room = (overrides: Partial<RoomBoundary> = {}): RoomBoundary => ({
  id: 'room:a',
  signature: 'w1|w2|w3|w4',
  typeCode: 'majlis',
  name: 'Majlis',
  polygon: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000)],
  areaMm2: 24_000_000,
  perimeterMm: 20_000,
  wallIds: ['w1'],
  ceilingHeightMm: 3000,
  ...overrides,
})

describe('cutting a wall around its openings', () => {
  it('leaves one solid panel when there is nothing in it', () => {
    const panels = wallPanels(NORTH, [])

    expect(panels).toHaveLength(1)
    expect(panels[0]).toMatchObject({ kind: 'wall', fromMm: 0, toMm: 6000, baseMm: 0, topMm: 3000 })
  })

  it('splits a door into two panels and a lintel', () => {
    // A 900 mm door starting at 2000, 2100 high in a 3000 wall.
    const panels = wallPanels(NORTH, [opening('door', 2000, 900)])

    expect(panels.map((panel) => panel.kind)).toEqual(['wall', 'lintel', 'wall'])
    expect(panels[0]).toMatchObject({ fromMm: 0, toMm: 2000 })
    // The head of the door to the underside of the slab — nothing left in the
    // doorway itself.
    expect(panels[1]).toMatchObject({ fromMm: 2000, toMm: 2900, baseMm: 2100, topMm: 3000 })
    expect(panels[2]).toMatchObject({ fromMm: 2900, toMm: 6000 })
  })

  it('puts a window on a spandrel and under a lintel', () => {
    const panels = wallPanels(NORTH, [opening('window', 2000, 1200)])

    // 900 sill, 1200 high, so the head is at 2100 in a 3000 wall.
    expect(panels.map((panel) => panel.kind)).toEqual(['wall', 'spandrel', 'lintel', 'wall'])
    expect(panels[1]).toMatchObject({ baseMm: 0, topMm: 900 })
    expect(panels[2]).toMatchObject({ baseMm: 2100, topMm: 3000 })
  })

  it('leaves no lintel over a full-height doorway', () => {
    const host = wall('w1', 0, 0, 6000, 0, 2100)
    const panels = wallPanels(host, [opening('door', 2000, 900, host)])

    // A zero-thickness lintel would be a z-fighting sliver, not a beam.
    expect(panels.map((panel) => panel.kind)).toEqual(['wall', 'wall'])
  })

  it('leaves no leading panel for an opening flush with the start', () => {
    const panels = wallPanels(NORTH, [opening('door', 0, 900)])

    expect(panels.map((panel) => panel.kind)).toEqual(['lintel', 'wall'])
    expect(panels[1]).toMatchObject({ fromMm: 900, toMm: 6000 })
  })

  it('leaves no trailing panel for an opening flush with the end', () => {
    const panels = wallPanels(NORTH, [opening('door', 5100, 900)])

    expect(panels.map((panel) => panel.kind)).toEqual(['wall', 'lintel'])
  })

  it('handles two openings in one wall, in order', () => {
    const panels = wallPanels(NORTH, [opening('door', 4000, 900), opening('window', 1000, 1200)])

    // Sorted, whatever order they arrived in — otherwise the cursor walks
    // backwards and emits a panel across the first opening.
    expect(panels.map((panel) => `${panel.kind}@${panel.fromMm}`)).toEqual([
      'wall@0',
      'spandrel@1000',
      'lintel@1000',
      'wall@2200',
      'lintel@4000',
      'wall@4900',
    ])
  })

  it('accounts for every millimetre of the wall', () => {
    const panels = wallPanels(NORTH, [opening('window', 2000, 1200)])
    const solidArea = panels.reduce(
      (total, panel) => total + (panel.toMm - panel.fromMm) * (panel.topMm - panel.baseMm),
      0,
    )
    const wallArea = 6000 * 3000
    const holeArea = 1200 * 1200

    // What is left plus what was removed is what was there. If this drifts, a
    // gap or an overlap has crept into the decomposition.
    expect(solidArea).toBe(wallArea - holeArea)
  })
})

describe('placing solids in the scene', () => {
  it('converts millimetres to metres exactly once', () => {
    const scene = extrudePlan(geometryOf({ walls: [NORTH] }), [])
    const [box] = scene.boxes

    expect(box?.size).toEqual({ x: 6, y: 3, z: 0.2 })
    // Centred along the wall, half its height up.
    expect(box?.centre).toEqual({ x: 3, y: 1.5, z: 0 })
  })

  it('maps the plan Y axis onto the scene Z axis', () => {
    const east = wall('w2', 6000, 0, 6000, 4000)
    const scene = extrudePlan(geometryOf({ walls: [east] }), [])
    const [box] = scene.boxes

    expect(box?.centre.x).toBe(6)
    expect(box?.centre.z).toBe(2)
    // A bearing turns towards +Z while a Y rotation turns towards −Z, so the
    // angle is negated. Getting this backwards mirrors the whole building.
    expect(box?.rotationY).toBeCloseTo(-Math.PI / 2, 6)
  })

  it('names every solid after the wall it came from', () => {
    const scene = extrudePlan(
      geometryOf({ walls: [NORTH], openings: [opening('door', 2000, 900)] }),
      [],
    )

    expect(scene.boxes).toHaveLength(3)
    expect(scene.boxes.every((box) => box.sourceId === 'w1')).toBe(true)
  })
})

describe('structure', () => {
  it('stands a column on the floor', () => {
    const column = createColumn({
      id: 'c1',
      centre: point(3000, 2000),
      widthMm: 400,
      depthMm: 400,
      heightMm: 3000,
    }).unwrap()
    const [box] = extrudePlan(geometryOf({ structural: [column] }), []).boxes

    expect(box?.size).toEqual({ x: 0.4, y: 3, z: 0.4 })
    expect(box?.centre).toEqual({ x: 3, y: 1.5, z: 2 })
  })

  it('hangs a beam from the ceiling rather than laying it on the floor', () => {
    const beam = createBeam({
      id: 'b1',
      start: point(0, 0),
      end: point(6000, 0),
      widthMm: 250,
      depthMm: 500,
    }).unwrap()
    const [box] = extrudePlan(geometryOf({ structural: [beam] }), []).boxes

    // A 500 deep beam under a 3 m slab: its soffit is at 2.5 m, so its centre
    // sits at 2.75 — not at 0.25, which would be a trip hazard.
    expect(box?.centre.y).toBeCloseTo(2.75, 6)
    expect(box?.size).toEqual({ x: 6, y: 0.5, z: 0.25 })
  })
})

describe('slabs', () => {
  it('lays a floor under each detected room', () => {
    const scene = extrudePlan(geometryOf({ walls: [NORTH] }), [room()])
    const [floor] = scene.slabs

    expect(floor?.kind).toBe('floor')
    // Below zero: finished floor level is the datum, and a slab sitting on top
    // of it would raise every room by its own thickness.
    expect(floor?.elevation).toBeLessThan(0)
    expect(floor?.outline[2]).toEqual({ x: 6, z: 4 })
    expect(floor?.typeCode).toBe('majlis')
  })

  it('leaves ceilings out unless asked — they hide everything from above', () => {
    const without = extrudePlan(geometryOf({ walls: [NORTH] }), [room()])
    const with_ = extrudePlan(geometryOf({ walls: [NORTH] }), [room()], { includeCeilings: true })

    expect(without.slabs.map((slab) => slab.kind)).toEqual(['floor'])
    expect(with_.slabs.map((slab) => slab.kind)).toEqual(['floor', 'ceiling'])
    expect(with_.slabs[1]?.elevation).toBe(3)
  })

  it('skips a room whose polygon is not a polygon', () => {
    const scene = extrudePlan(geometryOf({ walls: [NORTH] }), [room({ polygon: [point(0, 0)] })])

    expect(scene.slabs).toEqual([])
  })
})

describe('the scene as a whole', () => {
  it('reports bounds a camera can frame', () => {
    const scene = extrudePlan(geometryOf({ walls: [NORTH] }), [room()])

    expect(scene.bounds?.max.y).toBeCloseTo(3, 6)
    expect(scene.bounds?.max.z).toBeGreaterThanOrEqual(4)
  })

  it('has no bounds when there is nothing to look at', () => {
    expect(extrudePlan(emptyGeometry(), []).bounds).toBeNull()
  })

  it('counts what the renderer will have to draw', () => {
    const scene = extrudePlan(
      geometryOf({ walls: [NORTH], openings: [opening('window', 2000, 1200)] }),
      [room()],
    )

    // Four wall pieces plus one floor.
    expect(solidCount(scene)).toBe(5)
  })
})
