import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_VIEWPORT, wallLengthMm } from '@buildflow/spatial'
import { usePlannerStore } from '@/stores/planner'

/**
 * The store is where the pure spatial core meets Immer's patches. What these
 * tests protect is the property that makes undo trustworthy: EVERY document
 * change goes through `commit`, so there is no edit the history never saw —
 * and the drawing loop that produces those edits, because a wall chain that
 * loses its anchor is a plan the user has to redraw.
 */

const point = (x: number, y: number) => ({ x, y })

/** Screen pixels for a plan point, at whatever viewport the store holds. */
const screenOf = (store: ReturnType<typeof usePlannerStore>, x: number, y: number) => ({
  x: x * store.viewport.scale + store.viewport.x,
  y: y * store.viewport.scale + store.viewport.y,
})

describe('the planner store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('records each edit and unwinds it exactly', () => {
    const store = usePlannerStore()
    store.addWall(point(0, 0), point(5000, 0))
    store.addWall(point(5000, 0), point(5000, 4000))

    expect(store.walls).toHaveLength(2)
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.walls.map((wall) => wall.id)).toEqual(['wall-1'])

    store.undo()
    expect(store.walls).toHaveLength(0)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(true)

    store.redo()
    store.redo()
    expect(store.walls.map((wall) => wall.id)).toEqual(['wall-1', 'wall-2'])
  })

  it('refuses a wall the domain rejects, and says why', () => {
    const store = usePlannerStore()

    // A click that travelled two millimetres is not a wall.
    expect(store.addWall(point(0, 0), point(2, 0))).toBeNull()
    expect(store.walls).toHaveLength(0)
    expect(store.lastError?.code).toBe('WALL_TOO_SHORT')
    // …and nothing entered the history, so Ctrl+Z has nothing to unwind.
    expect(store.canUndo).toBe(false)
  })

  it('never reuses an id, even after an undo frees one', () => {
    const store = usePlannerStore()
    store.addWall(point(0, 0), point(5000, 0))
    store.undo()
    store.addWall(point(0, 0), point(4000, 0))

    // A reused id would let a redo resurrect a wall under a live one's name.
    expect(store.walls.map((wall) => wall.id)).toEqual(['wall-2'])
  })

  describe('drawing a chain', () => {
    it('anchors on the first click and re-anchors on every wall it commits', () => {
      const store = usePlannerStore()
      store.setTool('wall')

      store.placeWallPoint(point(0, 0))
      expect(store.walls).toHaveLength(0)
      expect(store.anchor).toEqual(point(0, 0))

      store.placeWallPoint(point(6000, 0))
      store.placeWallPoint(point(6000, 4000))

      expect(store.walls).toHaveLength(2)
      // The chain continues from the corner just drawn — four clicks, one room.
      expect(store.anchor).toEqual(point(6000, 4000))
      expect(store.walls[1]?.start).toEqual(point(6000, 0))
    })

    it('keeps the anchor where it was when a wall is rejected', () => {
      const store = usePlannerStore()
      store.setTool('wall')
      store.placeWallPoint(point(0, 0))
      store.placeWallPoint(point(3, 0))

      expect(store.walls).toHaveLength(0)
      // Moving the anchor to the rejected point would leave the next click
      // drawing from a corner that does not exist.
      expect(store.anchor).toEqual(point(0, 0))
    })

    it('discards the half-drawn segment when the chain ends', () => {
      const store = usePlannerStore()
      store.setTool('wall')
      store.placeWallPoint(point(0, 0))
      store.finishWallChain()

      expect(store.anchor).toBeNull()
      expect(store.walls).toHaveLength(0)
    })

    it('abandons the chain when the tool changes', () => {
      const store = usePlannerStore()
      store.setTool('wall')
      store.placeWallPoint(point(0, 0))
      store.setTool('select')

      expect(store.anchor).toBeNull()
    })
  })

  describe('live dimensions', () => {
    it('draws a wall of exactly the typed length, along the pointed direction', () => {
      const store = usePlannerStore()
      store.setTool('wall')
      store.placeWallPoint(point(0, 0))
      // The pointer indicates east, imprecisely — the typed length is exact.
      store.pointer = point(3597, 0)

      expect(store.commitDimension(3600)).toBe(true)
      expect(store.walls[0]?.end).toEqual(point(3600, 0))
      // …and the chain carries on from the end it just placed.
      expect(store.anchor).toEqual(point(3600, 0))
    })

    it('resizes the selected wall from its start, holding the direction', () => {
      const store = usePlannerStore()
      const id = store.addWall(point(1000, 1000), point(4000, 1000))
      store.selection = new Set([id as string])

      expect(store.dimensionMm).toBe(3000)
      expect(store.commitDimension(5500)).toBe(true)

      const wall = store.walls[0]
      expect(wall?.start).toEqual(point(1000, 1000))
      expect(wall?.end).toEqual(point(6500, 1000))
      expect(store.canUndo).toBe(true)
    })

    it('rejects a length the domain will not accept, leaving the wall alone', () => {
      const store = usePlannerStore()
      const id = store.addWall(point(0, 0), point(4000, 0))
      store.selection = new Set([id as string])

      expect(store.commitDimension(2)).toBe(false)
      expect(wallLengthMm(store.walls[0]!)).toBe(4000)
      expect(store.lastError?.code).toBe('WALL_TOO_SHORT')
    })

    it('has nothing to dimension with two walls selected', () => {
      const store = usePlannerStore()
      store.addWall(point(0, 0), point(4000, 0))
      store.addWall(point(0, 0), point(0, 4000))
      store.selection = new Set(['wall-1', 'wall-2'])

      expect(store.dimensionMm).toBeNull()
      expect(store.commitDimension(5000)).toBe(false)
    })
  })

  describe('selection', () => {
    it('selects the wall under the pointer, measured against the centreline', () => {
      const store = usePlannerStore()
      store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
      store.addWall(point(0, 0), point(6000, 0))

      store.selectAt(screenOf(store, 3000, 50), 'replace')
      expect(store.selectedIds).toEqual(['wall-1'])

      // Well clear of the wall: the click lands on nothing and clears.
      store.selectAt(screenOf(store, 3000, 5000), 'replace')
      expect(store.selectedIds).toEqual([])
    })

    it('drops ids the document no longer holds when an edit is undone', () => {
      const store = usePlannerStore()
      const id = store.addWall(point(0, 0), point(6000, 0))
      store.selection = new Set([id as string])

      store.undo()

      // A selection pointing at a wall that no longer exists would make the
      // next Delete act on nothing — or, after a redo, on the wrong thing.
      expect(store.selectedIds).toEqual([])
    })

    it('takes only what is enclosed when the marquee is dragged right', () => {
      const store = usePlannerStore()
      store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
      store.addWall(point(0, 0), point(2000, 0))
      store.addWall(point(0, 0), point(20_000, 0))

      store.beginMarquee(screenOf(store, -500, -500))
      store.updateMarquee(screenOf(store, 3000, 500))
      store.endMarquee('replace')

      expect(store.selectedIds).toEqual(['wall-1'])
    })

    it('takes anything it touches when the marquee is dragged left', () => {
      const store = usePlannerStore()
      store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
      store.addWall(point(0, 0), point(2000, 0))
      store.addWall(point(0, 0), point(20_000, 0))

      store.beginMarquee(screenOf(store, 3000, 500))
      store.updateMarquee(screenOf(store, 1000, -500))
      store.endMarquee('replace')

      expect(store.selectedIds.sort()).toEqual(['wall-1', 'wall-2'])
    })

    it('deletes the selection in one undoable step', () => {
      const store = usePlannerStore()
      store.addWall(point(0, 0), point(6000, 0))
      store.addWall(point(0, 0), point(0, 4000))
      store.selection = new Set(['wall-1', 'wall-2'])

      store.deleteSelected()
      expect(store.walls).toHaveLength(0)

      store.undo()
      expect(store.walls).toHaveLength(2)
    })
  })

  describe('snapping through the index', () => {
    it('takes an existing endpoint over the grid intersection beside it', () => {
      const store = usePlannerStore()
      store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
      // An endpoint deliberately off the 100 mm snap grid, so the two sources
      // genuinely disagree about where the pointer should land.
      store.addWall(point(0, 0), point(5987, 0))
      store.anchor = null

      const resolved = store.resolvePointer(screenOf(store, 5992, 3))

      expect(store.lastSnap?.kind).toBe('endpoint')
      expect(resolved).toEqual(point(5987, 0))
    })

    it('falls through to the grid when no wall is near', () => {
      const store = usePlannerStore()
      store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
      store.addWall(point(0, 0), point(6000, 0))

      const resolved = store.resolvePointer(screenOf(store, 2010, 4020))

      expect(store.lastSnap?.kind).toBe('grid')
      expect(resolved).toEqual(point(2000, 4000))
    })

    it('never snaps a dragged endpoint to the wall it belongs to', () => {
      const store = usePlannerStore()
      store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
      const id = store.addWall(point(0, 0), point(6000, 0))
      store.beginDrag(id as string, 'end')

      store.resolvePointer(screenOf(store, 6003, 2))

      // Its own endpoint is right there; taking it would pin the drag in place.
      expect(store.lastSnap?.kind).not.toBe('endpoint')
    })
  })

  describe('dragging an endpoint', () => {
    it('commits ONE undo step for the whole gesture', () => {
      const store = usePlannerStore()
      const id = store.addWall(point(0, 0), point(6000, 0))
      const before = store.history.past.length

      store.beginDrag(id as string, 'end')
      store.endDrag(point(6000, 3000))

      expect(store.walls[0]?.end).toEqual(point(6000, 3000))
      expect(store.history.past.length).toBe(before + 1)
    })

    it('keeps the wall in place rather than collapsing it onto its own start', () => {
      const store = usePlannerStore()
      const id = store.addWall(point(0, 0), point(6000, 0))

      store.beginDrag(id as string, 'end')
      store.endDrag(point(0, 0))

      expect(store.walls[0]?.end).toEqual(point(6000, 0))
      expect(store.lastError?.code).toBe('WALL_TOO_SHORT')
    })

    it('preserves draw order, so an edit does not change what a click selects', () => {
      const store = usePlannerStore()
      store.addWall(point(0, 0), point(6000, 0))
      const id = store.addWall(point(0, 0), point(0, 4000))

      store.beginDrag(id as string, 'end')
      store.endDrag(point(0, 5000))

      expect(store.walls.map((wall) => wall.id)).toEqual(['wall-1', 'wall-2'])
    })
  })

  describe('the viewport', () => {
    it('stays out of the history — Ctrl+Z does not scroll', () => {
      const store = usePlannerStore()
      store.addWall(point(0, 0), point(6000, 0))
      store.pan(120, -40)
      const panned = { ...store.viewport }

      store.undo()

      expect(store.viewport).toEqual(panned)
      expect(store.walls).toHaveLength(0)
    })

    it('frames the whole plan, thickness included', () => {
      const store = usePlannerStore()
      store.setSize({ width: 800, height: 600 })
      store.addWall(point(0, 0), point(6000, 0))

      // A centreline's bounds would be zero-height and the fit would divide by
      // zero; the drawn wall is 200 mm tall, which is what gets framed.
      expect(store.planBounds).toEqual({ minX: 0, minY: -100, maxX: 6000, maxY: 100 })
      store.zoomToFit()
      expect(store.viewport.scale).toBeGreaterThan(0)
    })
  })
})
