import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_VIEWPORT, isBeam } from '@buildflow/spatial'
import { usePlannerStore } from '@/stores/planner'

/**
 * Sprint 5 in the store: openings hosted on walls, structure that is not a
 * wall, layers that decide what can be touched, and a background whose scale
 * the user establishes by naming one distance they know.
 *
 * The rule these tests exist to hold: an opening has NO position of its own.
 * Everything that could leave one stranded — deleting its wall, shortening its
 * wall, hiding its layer — is handled where it happens, in one commit, so undo
 * restores the pair together.
 */

const point = (x: number, y: number) => ({ x, y })

const screenOf = (store: ReturnType<typeof usePlannerStore>, x: number, y: number) => ({
  x: x * store.viewport.scale + store.viewport.x,
  y: y * store.viewport.scale + store.viewport.y,
})

/** A store with one 6 m wall along the x axis, framed at a workable zoom. */
function withWall() {
  const store = usePlannerStore()
  store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
  const id = store.addWall(point(0, 0), point(6000, 0)) as string
  return { store, wallId: id }
}

describe('openings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('centres a door on the point clicked, hosted on the wall under it', () => {
    const { store, wallId } = withWall()

    const id = store.placeOpening(point(3000, 40), 'door')

    expect(id).not.toBeNull()
    const opening = store.openings[0]
    expect(opening?.wallId).toBe(wallId)
    // 900 mm wide, centred on 3000 → its near jamb sits at 2550.
    expect(opening?.offsetMm).toBe(2550)
    expect(opening?.widthMm).toBe(900)
  })

  it('refuses a door placed on empty space, and says so', () => {
    const { store } = withWall()

    expect(store.placeOpening(point(3000, 5000), 'door')).toBeNull()
    expect(store.openings).toHaveLength(0)
    expect(store.lastError?.code).toBe('OPENING_NEEDS_A_WALL')
  })

  it('refuses a second opening that would overlap the first', () => {
    const { store } = withWall()
    store.placeOpening(point(3000, 0), 'door')

    expect(store.placeOpening(point(3200, 0), 'window')).toBeNull()
    expect(store.lastError?.code).toBe('OPENING_OVERLAPS')
    expect(store.openings).toHaveLength(1)
  })

  it('selects the door rather than the wall it is cut into', () => {
    const { store } = withWall()
    const id = store.placeOpening(point(3000, 0), 'door')

    store.selectAt(screenOf(store, 3000, 40), 'replace')

    expect(store.selectedIds).toEqual([id])
  })

  it('takes its width from the live dimension field', () => {
    const { store } = withWall()
    const id = store.placeOpening(point(3000, 0), 'door')
    store.selection = new Set([id as string])

    expect(store.dimensionMm).toBe(900)
    expect(store.commitDimension(1500)).toBe(true)

    // Resized about its own centre — 3000 stays the middle of the door.
    expect(store.openings[0]?.offsetMm).toBe(2250)
    expect(store.openings[0]?.widthMm).toBe(1500)
  })

  it('goes with its wall, in ONE undo step', () => {
    const { store, wallId } = withWall()
    store.placeOpening(point(3000, 0), 'door')
    store.selection = new Set([wallId])

    store.deleteSelected()
    expect(store.walls).toHaveLength(0)
    // A door whose wall is gone has no position at all.
    expect(store.openings).toHaveLength(0)

    store.undo()
    expect(store.walls).toHaveLength(1)
    expect(store.openings).toHaveLength(1)
  })

  it('is dropped when its wall is shortened past it, in the same commit', () => {
    const { store, wallId } = withWall()
    store.placeOpening(point(5000, 0), 'door')
    expect(store.openings).toHaveLength(1)

    store.beginDrag(wallId, 'end')
    store.endDrag(point(2000, 0))

    // The wall is now 2 m long and cannot host a door that started at 4550.
    expect(store.openings).toHaveLength(0)
    store.undo()
    expect(store.openings).toHaveLength(1)
    expect(store.walls[0]?.end).toEqual(point(6000, 0))
  })

  it('survives a wall edit it still fits inside', () => {
    const { store, wallId } = withWall()
    store.placeOpening(point(1000, 0), 'door')

    store.beginDrag(wallId, 'end')
    store.endDrag(point(4000, 0))

    expect(store.openings).toHaveLength(1)
  })
})

describe('structure', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('aligns a dropped column with the wall running through it', () => {
    const store = usePlannerStore()
    store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
    store.addWall(point(0, 0), point(0, 6000))

    store.placeColumn(point(0, 3000))

    const column = store.structural[0]
    expect(column && !isBeam(column) ? column.rotationDeg : null).toBe(90)
  })

  it('leaves a column in open floor square to the plan', () => {
    const store = usePlannerStore()
    store.placeColumn(point(10_000, 10_000))

    const column = store.structural[0]
    expect(column && !isBeam(column) ? column.rotationDeg : null).toBe(0)
  })

  it('draws beams as a chain, like walls, on the beam tool', () => {
    const store = usePlannerStore()
    store.setTool('beam')

    store.placeWallPoint(point(0, 0))
    store.placeWallPoint(point(6000, 0))
    store.placeWallPoint(point(6000, 4000))

    expect(store.walls).toHaveLength(0)
    expect(store.structural).toHaveLength(2)
    expect(store.structural.every(isBeam)).toBe(true)
    expect(store.anchor).toEqual(point(6000, 4000))
  })

  it('resizes a selected beam from the dimension field', () => {
    const store = usePlannerStore()
    store.setTool('beam')
    const id = store.addBeam(point(0, 0), point(6000, 0)) as string
    store.setTool('select')
    store.selection = new Set([id])

    expect(store.dimensionMm).toBe(6000)
    expect(store.commitDimension(4500)).toBe(true)

    const beam = store.structural[0]
    expect(beam && isBeam(beam) ? beam.end : null).toEqual(point(4500, 0))
  })

  it('does not host openings — structure is not a wall', () => {
    const store = usePlannerStore()
    store.viewport = { ...DEFAULT_VIEWPORT, x: 0, y: 0, scale: 0.05 }
    store.addBeam(point(0, 0), point(6000, 0))

    expect(store.placeOpening(point(3000, 0), 'door')).toBeNull()
    expect(store.lastError?.code).toBe('OPENING_NEEDS_A_WALL')
  })
})

describe('layers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('puts new entities on the active layer', () => {
    const store = usePlannerStore()
    store.setActiveLayer('structure')
    store.addWall(point(0, 0), point(6000, 0))

    expect(store.walls[0]?.layer).toBe('structure')
  })

  it('stops a click selecting anything on a hidden layer', () => {
    const { store } = withWall()
    store.toggleLayerVisible('default')

    store.selectAt(screenOf(store, 3000, 0), 'replace')

    // Selecting the invisible is indistinguishable from a malfunction.
    expect(store.selectedIds).toEqual([])
  })

  it('drops a hidden entity out of the selection it was already in', () => {
    const { store, wallId } = withWall()
    store.selection = new Set([wallId])

    store.toggleLayerVisible('default')

    // Otherwise the next Delete destroys something the user cannot see.
    expect(store.selectedIds).toEqual([])
  })

  it('keeps a locked layer visible and untouchable', () => {
    const { store } = withWall()
    store.toggleLayerLocked('default')

    store.selectAt(screenOf(store, 3000, 0), 'replace')

    expect(store.selectedIds).toEqual([])
    expect(store.visibleWalls).toHaveLength(1)
  })

  it('hides a wall from snapping as well as from the eye', () => {
    const { store } = withWall()
    store.toggleLayerVisible('default')

    store.resolvePointer(screenOf(store, 6002, 2))

    // Snapping to an invisible endpoint reads as the pointer jumping at random.
    expect(store.lastSnap?.kind).not.toBe('endpoint')
  })

  it('undoes a layer change, because layer state is plan data', () => {
    const { store } = withWall()
    store.toggleLayerVisible('default')

    store.undo()

    expect(store.visibleWalls).toHaveLength(1)
  })

  it('hides a wall together with the doors hosted on it', () => {
    const { store } = withWall()
    const id = store.placeOpening(point(3000, 0), 'door') as string
    store.toggleLayerVisible('default')

    // A door floating on a hidden wall would be absurd, so an opening takes
    // its layer from its host rather than carrying one of its own.
    expect(store.selectableIds.has(id)).toBe(false)
  })
})

describe('the background', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const survey = { source: 'blob:survey', pixelWidth: 2000, pixelHeight: 1000 }

  it('places an image uncalibrated but visible', () => {
    const store = usePlannerStore()

    expect(store.setBackground(survey)).toBe(true)
    expect(store.background?.mmPerPixel).toBe(1)
    expect(store.canUndo).toBe(true)
  })

  it('refuses an image with no pixels', () => {
    const store = usePlannerStore()

    expect(store.setBackground({ ...survey, pixelWidth: 0 })).toBe(false)
    expect(store.lastError?.code).toBe('BACKGROUND_EMPTY')
  })

  it('calibrates from two picks and a known length', () => {
    const store = usePlannerStore()
    store.setBackground(survey)

    store.pickCalibrationPoint(point(0, 0))
    store.pickCalibrationPoint(point(90, 0))
    expect(store.calibrating).toBe(true)
    expect(store.calibrationLengthMm).toBe(90)

    // Those 90 mm are really a 900 mm door, so every image pixel is 10 mm.
    expect(store.applyCalibration(900)).toBe(true)
    expect(store.background?.mmPerPixel).toBeCloseTo(10, 6)
    expect(store.calibrating).toBe(false)
  })

  it('undoes a calibration — mis-clicking one is exactly why', () => {
    const store = usePlannerStore()
    store.setBackground(survey)
    store.pickCalibrationPoint(point(0, 0))
    store.pickCalibrationPoint(point(90, 0))
    store.applyCalibration(900)

    store.undo()

    expect(store.background?.mmPerPixel).toBe(1)
  })

  it('will not calibrate before both ends are picked', () => {
    const store = usePlannerStore()
    store.setBackground(survey)
    store.pickCalibrationPoint(point(0, 0))

    expect(store.applyCalibration(900)).toBe(false)
  })

  it('reports a length that cannot be used instead of applying it', () => {
    const store = usePlannerStore()
    store.setBackground(survey)
    store.pickCalibrationPoint(point(0, 0))
    store.pickCalibrationPoint(point(90, 0))

    expect(store.applyCalibration(0)).toBe(false)
    expect(store.lastError?.code).toBe('CALIBRATION_INVALID_LENGTH')
    // The picks survive, so the user retypes rather than re-picking.
    expect(store.calibrating).toBe(true)
  })

  it('abandons a half-picked calibration when the tool changes', () => {
    const store = usePlannerStore()
    store.setBackground(survey)
    store.setTool('calibrate')
    store.pickCalibrationPoint(point(0, 0))

    store.setTool('wall')

    expect(store.calibrating).toBe(false)
  })

  it('never lets the background join the plan bounds', () => {
    const store = usePlannerStore()
    store.setBackground(survey)

    // Fit frames the DRAWING. A 2000 px photo would otherwise decide the zoom
    // of a plan that has nothing in it yet.
    expect(store.planBounds).toBeNull()
  })
})
