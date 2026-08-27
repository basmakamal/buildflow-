import { afterAll, describe, expect, it } from 'vitest'
import { createWall, wallBounds, type Wall } from '../src/domain/wall'
import { createOpening, type Opening } from '../src/domain/opening'
import { point } from '../src/domain/geometry'
import { SpatialIndex, resolveHits } from '../src/domain/spatial-index'
import { wallSnapCandidates } from '../src/domain/wall-snapping'
import { resolveSnap, DEFAULT_SNAP_CONFIG } from '../src/domain/snapping'
import { detectRooms } from '../src/domain/room-detection'
import { extrudePlan, solidCount } from '../src/domain/extrusion'
import { emptyGeometry } from '../src/domain/plan'
import { DEFAULT_VIEWPORT, visibleBounds, pxToMm } from '../src/domain/viewport'
import type { RoomBoundary } from '../src/domain/room'

/**
 * The Phase 5 exit criteria, measured. docs/16 Phase 5
 *
 *   60 FPS at 500 objects in the planner  -> 16.67 ms of CPU per frame
 *   30 FPS for a 200 m2 unit in 3D        -> 33.33 ms of CPU per frame
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. It measures the DOMAIN work a frame
 * depends on, which is the half that lives in this repo. Rasterisation belongs
 * to Konva and to the GPU, and no number here speaks for it.
 *
 * That makes this a FLOOR, not a certificate: if resolving a snap against 500
 * walls cost 20 ms, 60 FPS would be unreachable however fast the canvas drew.
 * Passing here means the criterion is still available, not that it is met —
 * only a browser holding a real plan can say that.
 *
 * Thresholds are a FRACTION of the frame budget on purpose, because the
 * renderer needs the rest of it.
 */

const FRAME_60_MS = 1000 / 60
const FRAME_30_MS = 1000 / 30

/**
 * Measurements, printed once at the end.
 *
 * Collected rather than logged per test because `no-console` is an error
 * repo-wide (eslint.config.js) and a benchmark is not an excuse to weaken it.
 * A benchmark that reports its numbers is a reporter, so it writes to stdout
 * deliberately, in one place, rather than scattering debug logging.
 */
const measured: string[] = []
const record = (label: string, ms: number, note = ''): void => {
  measured.push(`  ${label.padEnd(34)} ${ms.toFixed(3).padStart(8)} ms  ${note}`)
}

afterAll(() => {
  process.stdout.write(`\nPhase 5 exit criteria — domain frame cost\n${measured.join('\n')}\n\n`)
})

/** Median of `runs` timings, in ms. Median, not mean: GC spikes are not typical. */
const timeMedian = (runs: number, body: () => unknown): number => {
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    body()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] as number
}

let sequence = 0
const wall = (x1: number, y1: number, x2: number, y2: number): Wall => {
  sequence += 1
  return createWall({ id: `w${sequence}`, start: point(x1, y1), end: point(x2, y2) }).unwrap()
}

/**
 * A `cols` x `rows` grid of rooms — the shape a real floor plate has, and the
 * one that stresses detection hardest: every interior wall is shared by two
 * faces, so the graph holds the most cycles its edge count allows.
 */
const grid = (cols: number, rows: number, cellW: number, cellH: number): Wall[] => {
  const walls: Wall[] = []
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      walls.push(wall(c * cellW, r * cellH, (c + 1) * cellW, r * cellH))
    }
  }
  for (let c = 0; c <= cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      walls.push(wall(c * cellW, r * cellH, c * cellW, (r + 1) * cellH))
    }
  }
  return walls
}

describe('planner exit criterion: 60 FPS at 500 objects', () => {
  const walls = grid(15, 15, 3000, 3000)
  const index = SpatialIndex.of(walls.map((w) => ({ id: w.id, bounds: wallBounds(w) })))
  const mmPerPx = pxToMm(DEFAULT_VIEWPORT, 1)

  it('is a plan of about 500 objects', () => {
    expect(walls.length).toBeGreaterThanOrEqual(480)
    expect(index.size).toBe(walls.length)
  })

  it('resolves a pointer-move snap well inside the frame budget', () => {
    // The genuinely per-frame path: every mouse move while drawing runs it.
    const median = timeMedian(200, () => {
      const target = point(22_000 + Math.random() * 200, 19_000 + Math.random() * 200)
      const candidates = wallSnapCandidates(target, walls, index, DEFAULT_SNAP_CONFIG, {
        mmPerPx,
        anchor: point(21_000, 18_000),
      })
      return resolveSnap(target, candidates)
    })

    record('snap resolve', median, `${walls.length} walls`)
    expect(median).toBeLessThan(FRAME_60_MS / 4)
  })

  it('culls to the viewport well inside the frame budget', () => {
    // Runs on every pan, zoom and redraw.
    const median = timeMedian(200, () => {
      const bounds = visibleBounds(DEFAULT_VIEWPORT, { width: 1920, height: 1080 })
      return resolveHits(walls, index.search(bounds))
    })

    record('viewport cull', median, `${walls.length} walls`)
    expect(median).toBeLessThan(FRAME_60_MS / 4)
  })

  it('rebuilds the whole index inside one frame', () => {
    // Worst case after a bulk edit — not per-frame, but it must not drop one.
    const median = timeMedian(50, () =>
      SpatialIndex.of(walls.map((w) => ({ id: w.id, bounds: wallBounds(w) }))),
    )

    record('index rebuild', median, `${walls.length} walls`)
    expect(median).toBeLessThan(FRAME_60_MS)
  })

  it('detects every room in the grid, off-thread but promptly', () => {
    // Worker-bound, so it may exceed a frame — but a user waiting seconds for
    // a room to appear is the same defect under a different name.
    const median = timeMedian(20, () => detectRooms(walls))
    const rooms = detectRooms(walls)

    record('room detection', median, `${walls.length} walls -> ${rooms.length} rooms`)
    expect(rooms).toHaveLength(15 * 15)
    expect(median).toBeLessThan(250)
  })
})

describe('viewer exit criterion: 30 FPS for a 200 m2 unit', () => {
  // Ten rooms of 5 m x 4 m = 200 m2 exactly, the size the criterion names.
  const walls = grid(5, 2, 5000, 4000)
  const openings: Opening[] = []
  for (const w of walls.slice(0, 12)) {
    const made = createOpening(
      { id: `o${w.id}`, wallId: w.id, kind: 'door', offsetMm: 1500 },
      w,
      openings.filter((o) => o.wallId === w.id),
    )
    if (made.isOk()) openings.push(made.unwrap())
  }

  const detected = detectRooms(walls)
  const rooms: RoomBoundary[] = detected.map((room, i) => ({
    id: `r${i}`,
    signature: room.signature,
    typeCode: null,
    name: `Room ${i + 1}`,
    polygon: room.polygon,
    areaMm2: room.areaMm2,
    perimeterMm: room.perimeterMm,
    wallIds: room.wallIds,
    ceilingHeightMm: 3000,
  }))

  const geometry = { ...emptyGeometry(), walls, openings }

  it('is a 200 m2 unit', () => {
    const totalM2 = rooms.reduce((sum, r) => sum + r.areaMm2, 0) / 1_000_000
    expect(rooms).toHaveLength(10)
    expect(totalM2).toBeCloseTo(200, 5)
  })

  it('extrudes the scene inside one 30 FPS frame', () => {
    const median = timeMedian(100, () => extrudePlan(geometry, rooms))
    const scene = extrudePlan(geometry, rooms)

    record('extrude 200 m2', median, `${openings.length} openings -> ${solidCount(scene)} solids`)
    expect(median).toBeLessThan(FRAME_30_MS)
  })

  it('produces a solid count a mid-range GPU can hold at 30 FPS', () => {
    // Not a timing but a DRAW-CALL budget, and the honest limit of what this
    // file can check: each solid is one box or slab, and mid-range integrated
    // graphics hold a few thousand comfortably.
    const scene = extrudePlan(geometry, rooms)
    expect(solidCount(scene)).toBeLessThan(2000)
  })
})
