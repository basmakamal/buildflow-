import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { createWall, type Wall } from '@buildflow/spatial'
import { toTransferable } from '@/workers/room-detection-client'

/**
 * The worker boundary. docs/08 §7.5
 *
 * A REGRESSION TEST FOR A BUG THE WHOLE SUITE MISSED. Room detection was dead
 * in the browser while 247 tests passed: the client shallow-copied each wall
 * with `{ ...wall }`, which unwraps the Vue Proxy on the wall but leaves the
 * `start` and `end` points as Proxies. `postMessage` cannot clone a Proxy, so
 * every detection request threw DataCloneError and the planner showed a plan
 * with no rooms — no areas, no BOQ quantities, and nothing that looked like an
 * error to the person drawing.
 *
 * It survived because the test environment has no `Worker`, so the client
 * takes its synchronous fallback and the boundary is never crossed. The
 * fallback is the right design; it just means the CROSSING needs its own test,
 * and structuredClone is the same algorithm postMessage uses.
 */

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  createWall({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }).unwrap()

describe('walls crossing to the worker', () => {
  it('survives structuredClone when the walls are reactive', () => {
    // Exactly what the store holds — reactive all the way down.
    const walls = reactive([wall('w1', 0, 0, 4000, 0), wall('w2', 4000, 0, 4000, 3000)])

    expect(() => structuredClone(toTransferable(walls))).not.toThrow()
  })

  it('refuses to be satisfied by a shallow copy', () => {
    // Pins the ACTUAL defect: were `toTransferable` ever reduced back to a
    // spread, this is the assertion that would fail rather than a browser.
    const walls = reactive([wall('w1', 0, 0, 4000, 0)])
    const shallow = walls.map((w) => ({ ...w }))

    expect(() => structuredClone(shallow)).toThrow()
  })

  it('carries every field the detector reads, by value', () => {
    const walls = reactive([wall('w1', 100, 200, 4000, 200)])
    const [sent] = structuredClone(toTransferable(walls))

    expect(sent).toEqual({
      id: 'w1',
      start: { x: 100, y: 200 },
      end: { x: 4000, y: 200 },
      thicknessMm: walls[0]?.thicknessMm,
      heightMm: walls[0]?.heightMm,
      layer: walls[0]?.layer,
    })
  })
})
