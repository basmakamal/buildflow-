import { defineStore } from 'pinia'
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'
import {
  DEFAULT_SNAP_CONFIG,
  DEFAULT_VIEWPORT,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WALL_THICKNESS_MM,
  SpatialIndex,
  angleDegrees,
  applySelection,
  beamLengthMm,
  boundsFromCorners,
  calibrateBackground,
  canEdit,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  DEFAULT_CEILING_HEIGHT_MM,
  centreOpeningAt,
  createBackground,
  createBeam,
  createColumn,
  createOpening,
  createWall,
  defaultLayers,
  distance,
  emptyHistory,
  fitToBounds,
  hitTestStructural,
  hitTestWalls,
  isBeam,
  marqueeHits,
  moveWallEnd,
  noLock,
  nextRedoLabel,
  nextUndoLabel,
  onSelectableLayers,
  onVisibleLayers,
  openingBounds,
  openingHit,
  openingsOn,
  pan as panViewport,
  pointAtAngle,
  pxToMm,
  reconcileRooms,
  record,
  redo as historyRedo,
  resizeOpening,
  resizeWall,
  resolveHits,
  roomAt,
  roomMetrics,
  selectionBounds,
  setBackgroundOpacity as applyBackgroundOpacity,
  setLayer,
  snap,
  structuralBounds,
  toWorld,
  toggleLocked,
  toggleVisible,
  totalFloorAreaMm2,
  unassignedRooms,
  undo as historyUndo,
  unionBounds,
  wallBounds,
  wallLengthMm,
  wallSnapCandidates,
  zoomAt,
  type Background,
  type BackgroundInput,
  type Bounds,
  type DomainError,
  type History,
  type Opening,
  type OpeningKind,
  type PlanLayer,
  type PlanLock,
  type Point,
  type RoomAssignment,
  type RoomBoundary,
  type RoomMetrics,
  type ScreenSize,
  type SelectionMode,
  type SnapConfig,
  type SnapResult,
  type SpanElement,
  type StructuralElement,
  type Viewport,
  type Wall,
  type WallEnd,
} from '@buildflow/spatial'
import { detectRoomsInWorker } from '@/workers/room-detection-client'
import {
  createPlan,
  createPlanRevision,
  dropLock,
  fetchPlan,
  fetchRevisions,
  restorePlanRevision,
  savePlanGeometry,
  takeLock,
  type RevisionSummary,
} from '@/api/plans'

/**
 * The planner store. docs/08 §7.2
 *
 * The one place in this app where a normalised client-side store is justified:
 * the planner holds hundreds of entities that reference each other and must
 * undo as a unit.
 *
 * EVERY EDIT GOES THROUGH `commit`. That is not a style preference — it is
 * what makes undo total. An edit that mutates state directly is an edit the
 * history never saw, and the user discovers it the first time Ctrl+Z leaves
 * their plan in a state that never existed.
 *
 * Undo/redo uses IMMER PATCHES rather than snapshots: a 400-object plan
 * snapshotted 50 times is tens of megabytes, while the patches describing
 * those same edits are bytes, and the inverses come free.
 *
 * The store computes NOTHING geometric itself. Every transform, snap, hit and
 * invariant comes from @buildflow/spatial, which is why those are tested in
 * milliseconds while this file stays a coordinator.
 */

enablePatches()

/** docs/08 §7.2, plus `calibrate` — the background needs a mode of its own. */
export type PlannerTool =
  'select' | 'pan' | 'wall' | 'door' | 'window' | 'column' | 'beam' | 'measure' | 'calibrate'

const OPENING_TOOLS: Partial<Record<PlannerTool, OpeningKind>> = {
  door: 'door',
  window: 'window',
}

/** Regional leaf and window widths, placed on the click and adjusted after. */
const PLACED_WIDTH_MM: Record<OpeningKind, number> = { door: 900, window: 1200 }

/**
 * Everything undo must restore. Viewport and selection are deliberately OUT.
 *
 * Layers and the background ARE in: they are drawn with the plan and saved
 * with it, and mis-calibrating a survey photo is precisely the kind of mistake
 * a user reaches for Ctrl+Z to fix.
 */
interface PlanDocument {
  walls: Wall[]
  openings: Opening[]
  structural: StructuralElement[]
  layers: PlanLayer[]
  background: Background | null
  /**
   * What the user has SAID about each detected space, keyed by the signature
   * of the walls enclosing it. docs/08 §7.4
   *
   * The rooms themselves are derived and live outside the document — they are
   * recomputed from the walls, so putting them in the history would mean two
   * undo steps for every wall edit. What cannot be recomputed is the name
   * somebody typed, and that is exactly what this holds.
   */
  roomAssignments: Record<string, RoomAssignment>
}

interface MarqueeState {
  origin: Point
  current: Point
}

/** An endpoint being dragged — the wall it belongs to, and which end. */
interface DragState {
  wallId: string
  end: WallEnd
}

/** The two points a calibration is measured between, as the user picks them. */
interface CalibrationState {
  from: Point
  to: Point | null
}

/** Anything the planner can select, projected to what selection needs. */
export interface Selectable {
  id: string
  bounds: Bounds
  layer: string
}

/**
 * The store's shape, stated rather than inferred.
 *
 * Without the annotation Pinia infers each initial value's LITERAL type, and
 * `tool` becomes `'select'` for ever — every later comparison to another tool
 * is then statically false, which the linter is right to complain about and
 * which would quietly disable half the toolbar.
 */
interface PlannerState {
  document: PlanDocument
  viewport: Viewport
  size: ScreenSize
  selection: Set<string>
  tool: PlannerTool
  snapConfig: SnapConfig
  wallDefaults: { thicknessMm: number; heightMm: number }
  /** Where newly drawn entities land. */
  activeLayer: string
  /** The last resolved snap, so the canvas can draw its guide. */
  lastSnap: SnapResult | null
  /** The point a wall or beam is being drawn from; null when nothing is in progress. */
  anchor: Point | null
  /** The last snapped pointer position — the ghost's far end. */
  pointer: Point | null
  marquee: MarqueeState | null
  drag: DragState | null
  calibration: CalibrationState | null
  /** Derived from the walls, never edited directly. docs/08 §7.4 */
  rooms: RoomBoundary[]
  /** True while the worker is thinking, so the panel can say so. */
  detecting: boolean
  /** Rises with every detection run, so a superseded answer can be dropped. */
  detectionToken: number
  /** The saved plan this editor is bound to; null until it loads. */
  planId: string | null
  /** The version the server last confirmed. What a save is checked against. */
  savedVersion: number
  /** Who holds the editor, as the server last reported it. docs/08 §7.6 */
  lock: PlanLock
  /** This browser's user, so `canEdit` can answer without asking the server. */
  userId: string | null
  saving: boolean
  loading: boolean
  lastSavedAt: Date | null
  /**
   * Set when the server refused a save because somebody else had already
   * saved. Surfaced loudly: the alternative is a user drawing for an hour into
   * a tab whose every save is being rejected.
   */
  conflicted: boolean
  revisions: RevisionSummary[]
  /** The room the panel is focused on — highlighted, not selected. */
  activeRoomId: string | null
  history: History<Patch>
  dirty: boolean
  /**
   * The last rejected edit. Surfaced, not swallowed: a wall that silently
   * fails to appear is the kind of bug a user works around for months.
   */
  lastError: DomainError | null
  /** Monotonic and never reused, so an undone id cannot return as another entity. */
  sequence: number
}

export const usePlannerStore = defineStore('planner', {
  state: (): PlannerState => ({
    document: {
      walls: [],
      openings: [],
      structural: [],
      layers: defaultLayers(),
      background: null,
      roomAssignments: {},
    },
    viewport: { ...DEFAULT_VIEWPORT },
    size: { width: 0, height: 0 },
    selection: new Set(),
    // Select, so a planner opened by mistake cannot draw anything.
    tool: 'select',
    snapConfig: { ...DEFAULT_SNAP_CONFIG },
    wallDefaults: {
      thicknessMm: DEFAULT_WALL_THICKNESS_MM,
      heightMm: DEFAULT_WALL_HEIGHT_MM,
    },
    activeLayer: 'default',
    lastSnap: null,
    anchor: null,
    pointer: null,
    marquee: null,
    drag: null,
    calibration: null,
    rooms: [],
    detecting: false,
    detectionToken: 0,
    planId: null,
    savedVersion: 0,
    lock: noLock(),
    userId: null,
    saving: false,
    loading: false,
    lastSavedAt: null,
    conflicted: false,
    revisions: [],
    activeRoomId: null,
    history: emptyHistory<Patch>(),
    dirty: false,
    lastError: null,
    sequence: 0,
  }),

  getters: {
    walls: (state): Wall[] => state.document.walls,
    openings: (state): Opening[] => state.document.openings,
    structural: (state): StructuralElement[] => state.document.structural,
    layers: (state): PlanLayer[] => state.document.layers,
    background: (state): Background | null => state.document.background,

    canUndo: (state) => historyCanUndo(state.history),
    canRedo: (state) => historyCanRedo(state.history),
    undoLabel: (state) => nextUndoLabel(state.history),
    redoLabel: (state) => nextRedoLabel(state.history),
    selectedIds: (state) => [...state.selection],

    /** Plan millimetres per screen pixel — every pixel tolerance goes through this. */
    mmPerPx: (state) => pxToMm(state.viewport, 1),
    /** The 12 px reference tolerance docs/08 §7.3 quotes, in plan millimetres. */
    toleranceMm: (state) => pxToMm(state.viewport, 12),

    /** Walls by id — openings are hosted, so almost everything needs this. */
    wallsById(state): Map<string, Wall> {
      return new Map(state.document.walls.map((wall) => [wall.id, wall]))
    },

    /**
     * Everything selectable, in DRAW order, projected to bounds and a layer.
     *
     * An opening inherits its host wall's layer: hiding the walls must hide
     * their doors too, since a door floating on a hidden wall would be absurd.
     */
    selectables(state): Selectable[] {
      const byId = new Map(state.document.walls.map((wall) => [wall.id, wall]))

      const walls = state.document.walls.map((wall) => ({
        id: wall.id,
        bounds: wallBounds(wall),
        layer: wall.layer,
      }))

      const openings = state.document.openings.flatMap((opening) => {
        const host = byId.get(opening.wallId)
        return host
          ? [{ id: opening.id, bounds: openingBounds(host, opening), layer: host.layer }]
          : []
      })

      const structural = state.document.structural.map((element) => ({
        id: element.id,
        bounds: structuralBounds(element),
        layer: element.layer,
      }))

      return [...walls, ...openings, ...structural]
    },

    /**
     * The R-tree, rebuilt whenever geometry changes. docs/08 §7.3
     *
     * A Pinia getter is a computed, so "rebuilt on geometry change" is the
     * literal behaviour rather than something every caller has to remember.
     */
    index(): SpatialIndex {
      return SpatialIndex.of(this.selectables)
    },

    /** Walls on visible layers — what the canvas draws, and what snapping reads. */
    visibleWalls(state): Wall[] {
      return onVisibleLayers(state.document.layers, state.document.walls)
    },

    visibleStructural(state): StructuralElement[] {
      return onVisibleLayers(state.document.layers, state.document.structural)
    },

    /** Ids on a layer that is both visible and unlocked. */
    selectableIds(): Set<string> {
      return new Set(onSelectableLayers(this.layers, this.selectables).map((entity) => entity.id))
    },

    planBounds(): Bounds | null {
      return this.selectables.reduce<Bounds | null>(
        (accumulated, entity) =>
          accumulated ? unionBounds(accumulated, entity.bounds) : { ...entity.bounds },
        null,
      )
    },

    marqueeBounds(state): Bounds | null {
      return state.marquee ? boundsFromCorners(state.marquee.origin, state.marquee.current) : null
    },

    /** The single selected wall, or null — what a dimension edit applies to. */
    selectedWall(state): Wall | null {
      if (state.selection.size !== 1) return null
      const [id] = [...state.selection]
      return state.document.walls.find((wall) => wall.id === id) ?? null
    },

    selectedOpening(state): Opening | null {
      if (state.selection.size !== 1) return null
      const [id] = [...state.selection]
      return state.document.openings.find((opening) => opening.id === id) ?? null
    },

    selectedBeam(state): SpanElement | null {
      if (state.selection.size !== 1) return null
      const [id] = [...state.selection]
      const element = state.document.structural.find((candidate) => candidate.id === id)
      return element && isBeam(element) ? element : null
    },

    /** The wall or beam being drawn but not yet committed — the ghost. */
    draft(state): { start: Point; end: Point } | null {
      if (!state.anchor || !state.pointer) return null
      return { start: state.anchor, end: state.pointer }
    },

    /**
     * The length the live dimension field shows and edits: whatever is in
     * progress, otherwise whatever single thing is selected. An opening's
     * dimension is its WIDTH, which is what anybody means by "how big is that
     * door".
     */
    dimensionMm(): number | null {
      const draft = this.draft
      if (draft) return Math.round(distance(draft.start, draft.end))
      if (this.selectedWall) return wallLengthMm(this.selectedWall)
      if (this.selectedBeam) return beamLengthMm(this.selectedBeam)
      return this.selectedOpening?.widthMm ?? null
    },

    dimensionAngleDeg(): number | null {
      const draft = this.draft
      if (draft) return angleDegrees(draft.start, draft.end)
      if (this.selectedWall) return angleDegrees(this.selectedWall.start, this.selectedWall.end)
      if (this.selectedBeam) return angleDegrees(this.selectedBeam.start, this.selectedBeam.end)
      return null
    },

    /** The room the panel has focused, if it still exists after a re-detection. */
    activeRoom(state): RoomBoundary | null {
      return state.rooms.find((room) => room.id === state.activeRoomId) ?? null
    },

    /** Σ floorArea — the figure docs/02 §3.4 checks against the unit's gross. */
    floorAreaMm2(state): number {
      return totalFloorAreaMm2(state.rooms)
    },

    /** Spaces nobody has said the purpose of yet. Until they are named, the
     * quantity rules have no room TYPE to key off, so they produce nothing. */
    unnamedRooms(state): RoomBoundary[] {
      return unassignedRooms(state.rooms)
    },

    /**
     * The BOQ inputs for one room. docs/02 §3.7
     *
     * The doors come from the room's own walls, because skirting stops at a
     * doorway and only the caller can join a room to its openings.
     */
    metricsFor(state) {
      return (roomId: string): RoomMetrics | null => {
        const room = state.rooms.find((candidate) => candidate.id === roomId)
        if (!room) return null

        const doors = state.document.openings
          .filter((opening) => opening.kind === 'door' && room.wallIds.includes(opening.wallId))
          .map((opening) => opening.widthMm)

        return roomMetrics(room, doors)
      }
    },

    /**
     * Whether this browser may edit at all.
     *
     * False while somebody else holds the lock — the planner then renders
     * normally but refuses every edit, which is what docs/08 §7.6 means by the
     * lock being HONEST about what is happening rather than silently merging.
     */
    readOnly(state): boolean {
      return state.userId !== null && !canEdit(state.lock, state.userId, new Date())
    },

    /** The name to show whoever is locked out. An id would help nobody. */
    lockedByName(state): string | null {
      return this.readOnly ? (state.lock.heldByName ?? state.lock.heldBy) : null
    },

    /** True while the user is picking the two ends of a known distance. */
    calibrating: (state) => state.calibration !== null,

    /** The measured line, once both ends are picked — what the field labels. */
    calibrationLengthMm(state): number | null {
      const calibration = state.calibration
      return calibration?.to ? Math.round(distance(calibration.from, calibration.to)) : null
    },
  },

  actions: {
    /**
     * The ONLY way the document changes.
     *
     * Immer produces the next document plus the patches and their inverses in
     * one pass; the history keeps them, and undo simply applies the inverse.
     * A recipe that changes nothing produces no patches, so `record` drops it
     * and the user never meets an undo step that does nothing.
     */
    commit(label: string, recipe: (draft: PlanDocument) => void) {
      // The single choke point every edit already passes through, so read-only
      // needs enforcing in exactly one place rather than in forty actions.
      if (this.readOnly) {
        this.lastError = {
          kind: 'conflict',
          code: 'PLAN_LOCKED',
          message: 'The plan is being edited by someone else',
          i18nKey: 'errors.plan.locked',
        }
        return
      }

      const [next, patches, inverse] = produceWithPatches(this.document, recipe)
      if (patches.length === 0) return

      this.document = next
      this.history = record(this.history, { label, patches, inverse })
      this.dirty = true
    },

    undo() {
      const step = historyUndo(this.history)
      if (!step.apply) return
      this.document = applyPatches(this.document, [...step.apply])
      this.history = step.history
      this.dirty = true
      this.pruneSelection()
    },

    redo() {
      const step = historyRedo(this.history)
      if (!step.apply) return
      this.document = applyPatches(this.document, [...step.apply])
      this.history = step.history
      this.dirty = true
      this.pruneSelection()
    },

    /**
     * Drops ids the document no longer holds, or that a layer has taken out of
     * reach.
     *
     * Undoing the creation of a selected wall would otherwise leave it
     * selected — and the next Delete would target something that is not there.
     * Hiding a layer is the same problem wearing a different hat: a Delete
     * must never destroy what the user cannot see.
     */
    pruneSelection() {
      const reachable = this.selectableIds
      const next = new Set([...this.selection].filter((id) => reachable.has(id)))
      if (next.size !== this.selection.size) this.selection = next
    },

    /**
     * Replaces one wall in place, keeping draw order — a wall that jumps to
     * the top of the stack on every edit changes which wall a click selects.
     */
    replaceWall(label: string, wall: Wall) {
      this.commit(label, (draft) => {
        const index = draft.walls.findIndex((candidate) => candidate.id === wall.id)
        if (index >= 0) draft.walls[index] = wall
      })
    },

    replaceStructural(label: string, element: StructuralElement) {
      this.commit(label, (draft) => {
        const index = draft.structural.findIndex((candidate) => candidate.id === element.id)
        if (index >= 0) draft.structural[index] = element
      })
    },

    nextId(prefix: string): string {
      this.sequence += 1
      return `${prefix}-${this.sequence}`
    },

    // ── walls ───────────────────────────────────────────────────────────────

    /**
     * Creates a wall, or records why it could not be created.
     *
     * The domain decides: a click that travelled two millimetres is not a
     * wall, and this is where that answer is respected rather than second
     * guessed. Returns the new id, or null on rejection.
     */
    addWall(start: Point, end: Point): string | null {
      const result = createWall({
        id: this.nextId('wall'),
        start,
        end,
        thicknessMm: this.wallDefaults.thicknessMm,
        heightMm: this.wallDefaults.heightMm,
        layer: this.activeLayer,
      })

      if (result.isErr()) {
        this.lastError = result.error
        return null
      }

      const wall = result.value
      this.lastError = null
      this.commit('wall.add', (draft) => {
        draft.walls.push(wall)
      })
      return wall.id
    },

    /**
     * One click of the wall or beam tool.
     *
     * The first sets the anchor; every later one commits a segment and
     * RE-ANCHORS on its end, so a room is four clicks rather than four
     * separate draws. A rejected segment leaves the anchor where it was, so
     * the next click continues from the corner the user can see.
     */
    placeWallPoint(planPoint: Point) {
      if (!this.anchor) {
        this.anchor = planPoint
        this.pointer = planPoint
        return
      }

      const placed =
        this.tool === 'beam'
          ? this.addBeam(this.anchor, planPoint)
          : this.addWall(this.anchor, planPoint)
      if (placed) this.anchor = planPoint
    },

    /** Ends the chain. The half-drawn segment is discarded, never committed. */
    finishWallChain() {
      this.anchor = null
      this.lastSnap = null
    },

    /**
     * Commits the live dimension: the length typed into the field.
     *
     * While drawing, it produces a segment of EXACTLY that length along the
     * direction the pointer indicates — which is how a plan gets a 3600 mm
     * wall without anyone dragging to 3597. With something selected instead it
     * resizes that: a wall and a beam from their start, an opening about its
     * own centre.
     */
    commitDimension(lengthMm: number): boolean {
      const draft = this.draft
      if (draft) {
        const heading = angleDegrees(draft.start, draft.end)
        const end = pointAtAngle(draft.start, heading, lengthMm)
        const placed =
          this.tool === 'beam' ? this.addBeam(draft.start, end) : this.addWall(draft.start, end)
        if (!placed) return false

        this.anchor = end
        this.pointer = end
        return true
      }

      const wall = this.selectedWall
      if (wall) {
        const result = resizeWall(wall, lengthMm)
        if (result.isErr()) {
          this.lastError = result.error
          return false
        }
        this.lastError = null
        this.replaceWall('wall.resize', result.value)
        return true
      }

      if (this.selectedOpening) return this.resizeSelectedOpening(lengthMm)

      const beam = this.selectedBeam
      if (!beam) return false

      const result = createBeam({
        ...beam,
        end: pointAtAngle(beam.start, angleDegrees(beam.start, beam.end), lengthMm),
      })
      if (result.isErr()) {
        this.lastError = result.error
        return false
      }
      this.lastError = null
      this.replaceStructural('beam.resize', result.value)
      return true
    },

    /**
     * Deletes the selection.
     *
     * Openings go with their host wall IN THE SAME COMMIT. Not for tidiness:
     * an opening whose wall is gone has no position at all, and leaving one
     * behind would strand it in the document where only undo could reach it.
     */
    deleteSelected() {
      if (this.selection.size === 0) return
      const doomed = new Set(this.selection)

      this.commit('delete', (draft) => {
        draft.walls = draft.walls.filter((wall) => !doomed.has(wall.id))
        draft.structural = draft.structural.filter((element) => !doomed.has(element.id))

        const surviving = new Set(draft.walls.map((wall) => wall.id))
        draft.openings = draft.openings.filter(
          (opening) => !doomed.has(opening.id) && surviving.has(opening.wallId),
        )
      })
      this.selection = new Set()
    },

    setWallThickness(thicknessMm: number) {
      this.wallDefaults = { ...this.wallDefaults, thicknessMm }
    },

    // ── openings ────────────────────────────────────────────────────────────

    /**
     * Places a door or window on the wall under the pointer.
     *
     * An opening cannot exist without a host, so a click on empty space is not
     * a placement — and it is REPORTED rather than silently dropped, because
     * "my door did not appear" deserves an answer.
     */
    placeOpening(planPoint: Point, kind: OpeningKind): string | null {
      const wallId = this.wallUnder(planPoint)
      const wall = wallId ? this.wallsById.get(wallId) : undefined
      if (!wall) {
        this.lastError = {
          kind: 'validation',
          code: 'OPENING_NEEDS_A_WALL',
          message: 'An opening must be placed on a wall',
          i18nKey: 'errors.opening.needs.a.wall',
        }
        return null
      }

      const widthMm = PLACED_WIDTH_MM[kind]
      const result = createOpening(
        {
          id: this.nextId(kind),
          wallId: wall.id,
          kind,
          offsetMm: centreOpeningAt(wall, planPoint, widthMm),
          widthMm,
        },
        wall,
        openingsOn(this.document.openings, wall.id),
      )

      if (result.isErr()) {
        this.lastError = result.error
        return null
      }

      const opening = result.value
      this.lastError = null
      this.commit('opening.add', (draft) => {
        draft.openings.push(opening)
      })
      return opening.id
    },

    resizeSelectedOpening(widthMm: number): boolean {
      const opening = this.selectedOpening
      const wall = opening ? this.wallsById.get(opening.wallId) : undefined
      if (!opening || !wall) return false

      const result = resizeOpening(
        wall,
        opening,
        widthMm,
        openingsOn(this.document.openings, wall.id),
      )
      if (result.isErr()) {
        this.lastError = result.error
        return false
      }

      const resized = result.value
      this.lastError = null
      this.commit('opening.resize', (draft) => {
        const index = draft.openings.findIndex((candidate) => candidate.id === resized.id)
        if (index >= 0) draft.openings[index] = resized
      })
      return true
    },

    // ── structure ───────────────────────────────────────────────────────────

    /**
     * Drops a column at a point, turned to match a wall running through it —
     * the alignment a user wants nine times out of ten and nobody enjoys
     * doing by hand.
     */
    placeColumn(planPoint: Point): string | null {
      const hostId = this.wallUnder(planPoint)
      const host = hostId ? this.wallsById.get(hostId) : undefined

      const result = createColumn({
        id: this.nextId('column'),
        centre: planPoint,
        rotationDeg: host ? angleDegrees(host.start, host.end) : 0,
        layer: this.activeLayer,
      })
      if (result.isErr()) {
        this.lastError = result.error
        return null
      }

      const column = result.value
      this.lastError = null
      this.commit('column.add', (draft) => {
        draft.structural.push(column)
      })
      return column.id
    },

    addBeam(start: Point, end: Point): string | null {
      const result = createBeam({
        id: this.nextId('beam'),
        start,
        end,
        layer: this.activeLayer,
      })
      if (result.isErr()) {
        this.lastError = result.error
        return null
      }

      const beam = result.value
      this.lastError = null
      this.commit('beam.add', (draft) => {
        draft.structural.push(beam)
      })
      return beam.id
    },

    // ── layers ──────────────────────────────────────────────────────────────

    setActiveLayer(id: string) {
      this.activeLayer = id
    },

    /**
     * Layer state is plan data, so these are undoable like any other edit.
     *
     * Hiding a layer acts on the drawing's contents rather than on the camera,
     * which is why it belongs in the history while a pan does not.
     */
    toggleLayerVisible(id: string) {
      const next = toggleVisible(this.document.layers, id)
      this.commit('layer.visibility', (draft) => {
        draft.layers = next
      })
      this.pruneSelection()
    },

    toggleLayerLocked(id: string) {
      const next = toggleLocked(this.document.layers, id)
      this.commit('layer.lock', (draft) => {
        draft.layers = next
      })
      this.pruneSelection()
    },

    renameLayer(id: string, name: string) {
      const next = setLayer(this.document.layers, id, { name })
      this.commit('layer.rename', (draft) => {
        draft.layers = next
      })
    },

    // ── background ──────────────────────────────────────────────────────────

    setBackground(input: BackgroundInput): boolean {
      const result = createBackground(input)
      if (result.isErr()) {
        this.lastError = result.error
        return false
      }

      const background = result.value
      this.lastError = null
      this.commit('background.set', (draft) => {
        draft.background = background
      })
      return true
    },

    clearBackground() {
      this.calibration = null
      this.commit('background.clear', (draft) => {
        draft.background = null
      })
    },

    setBackgroundOpacity(opacity: number) {
      const background = this.document.background
      if (!background) return

      const next = applyBackgroundOpacity(background, opacity)
      this.commit('background.opacity', (draft) => {
        draft.background = next
      })
    },

    /**
     * Calibration, as two picks and a number.
     *
     * The first click starts it, the second closes the measured line, and only
     * then does the user say what that line really is — which is the order
     * they can actually work in, because they have to SEE the line before they
     * can name it.
     */
    pickCalibrationPoint(planPoint: Point) {
      this.calibration = this.calibration
        ? { ...this.calibration, to: planPoint }
        : { from: planPoint, to: null }
    },

    cancelCalibration() {
      this.calibration = null
    },

    applyCalibration(knownLengthMm: number): boolean {
      const background = this.document.background
      const calibration = this.calibration
      if (!background || !calibration?.to) return false

      const result = calibrateBackground(
        background,
        calibration.from,
        calibration.to,
        knownLengthMm,
      )
      if (result.isErr()) {
        this.lastError = result.error
        return false
      }

      const calibrated = result.value
      this.lastError = null
      this.commit('background.calibrate', (draft) => {
        draft.background = calibrated
      })
      this.calibration = null
      return true
    },

    // ── viewport ────────────────────────────────────────────────────────────
    // Not part of the document: undoing an edit must not also undo the pan
    // that happened to precede it. Nobody expects Ctrl+Z to scroll.

    setSize(size: ScreenSize) {
      this.size = size
    },

    pan(deltaX: number, deltaY: number) {
      this.viewport = panViewport(this.viewport, deltaX, deltaY)
    },

    zoomAt(anchor: Point, factor: number) {
      this.viewport = zoomAt(this.viewport, anchor, factor)
    },

    zoomToFit() {
      const bounds = this.planBounds
      if (!bounds || this.size.width === 0) return
      this.viewport = fitToBounds(this.viewport, bounds, this.size)
    },

    zoomToSelection() {
      const bounds = selectionBounds(this.selectables, this.selection)
      if (!bounds || this.size.width === 0) return
      this.viewport = fitToBounds(this.viewport, bounds, this.size)
    },

    // ── pointer ─────────────────────────────────────────────────────────────

    /**
     * Screen → plan, through the whole snapping pipeline.
     *
     * Scene candidates come from the R-tree, ambient ones from the config, and
     * `resolveSnap` decides between them by PRIORITY. Hidden walls contribute
     * nothing — snapping to something invisible is indistinguishable from the
     * pointer jumping at random. The wall being dragged is excluded too,
     * because a wall that snaps to itself never moves.
     */
    resolvePointer(screen: Point): Point {
      const world = toWorld(this.viewport, screen)
      const sceneCandidates = wallSnapCandidates(
        world,
        this.visibleWalls,
        this.index,
        this.snapConfig,
        {
          mmPerPx: this.mmPerPx,
          anchor: this.anchor,
          ...(this.drag ? { exclude: new Set([this.drag.wallId]) } : {}),
        },
      )

      const result = snap(world, this.snapConfig, this.toleranceMm, this.anchor, sceneCandidates)
      this.lastSnap = result
      this.pointer = result.point
      return result.point
    },

    /** The wall under a PLAN point, on a reachable layer, narrowed by the index. */
    wallUnder(planPoint: Point): string | null {
      const reachable = this.selectableIds
      const near = resolveHits(
        this.document.walls.filter((wall) => reachable.has(wall.id)),
        this.index.near(planPoint, this.toleranceMm + this.wallDefaults.thicknessMm),
      )
      return hitTestWalls(near, planPoint, this.toleranceMm)
    },

    /**
     * The topmost entity under a screen point.
     *
     * Structure, then openings, then walls — the reverse of draw order, so a
     * click takes what is on top. Clicking a door selects the door rather than
     * the wall it is cut into, which is what the user is pointing at.
     */
    entityAt(screen: Point): string | null {
      const world = toWorld(this.viewport, screen)
      const nearby = new Set(
        this.index.near(world, this.toleranceMm + this.wallDefaults.thicknessMm),
      )
      const reachable = this.selectableIds
      const eligible = (id: string) => nearby.has(id) && reachable.has(id)

      const structural = hitTestStructural(
        this.document.structural.filter((element) => eligible(element.id)),
        world,
        this.toleranceMm,
      )
      if (structural) return structural

      for (let index = this.document.openings.length - 1; index >= 0; index -= 1) {
        const opening = this.document.openings[index]
        if (!opening || !eligible(opening.id)) continue

        const host = this.wallsById.get(opening.wallId)
        if (host && openingHit(host, opening, world, this.toleranceMm)) return opening.id
      }

      return hitTestWalls(
        this.document.walls.filter((wall) => eligible(wall.id)),
        world,
        this.toleranceMm,
      )
    },

    selectAt(screen: Point, mode: SelectionMode) {
      const hit = this.entityAt(screen)
      this.selection = applySelection(this.selection, hit ? [hit] : [], hit ? mode : 'replace')
    },

    beginMarquee(screen: Point) {
      const world = toWorld(this.viewport, screen)
      this.marquee = { origin: world, current: world }
    },

    updateMarquee(screen: Point) {
      if (!this.marquee) return
      this.marquee = { ...this.marquee, current: toWorld(this.viewport, screen) }
    },

    /**
     * Closes the marquee, honouring the direction convention every CAD tool
     * shares: dragging right takes only what is fully enclosed, dragging left
     * takes anything it touches.
     */
    endMarquee(mode: SelectionMode) {
      const marquee = this.marquee
      this.marquee = null
      if (!marquee) return

      const direction = marquee.current.x >= marquee.origin.x ? 'right' : 'left'
      const hits = marqueeHits(
        onSelectableLayers(this.layers, this.selectables),
        boundsFromCorners(marquee.origin, marquee.current),
        direction,
      )
      this.selection = applySelection(this.selection, hits, mode)
    },

    // ── endpoint dragging ───────────────────────────────────────────────────

    beginDrag(wallId: string, end: WallEnd) {
      this.drag = { wallId, end }
    },

    /**
     * Commits a dragged endpoint.
     *
     * ONE commit at the end of the drag, not one per pointer move: fifty
     * commits would leave fifty undo steps for a single gesture, and Ctrl+Z
     * would crawl the endpoint back across the screen.
     *
     * Openings the shortened wall can no longer host go in the SAME commit.
     * The alternative is a door hanging off the end of a wall, which docs/02
     * §3.5 forbids — so the invariant is enforced at the one moment it could
     * be broken, and undo restores wall and door together.
     */
    endDrag(planPoint: Point) {
      const drag = this.drag
      this.drag = null
      if (!drag) return

      const wall = this.document.walls.find((candidate) => candidate.id === drag.wallId)
      if (!wall) return

      const result = moveWallEnd(wall, drag.end, planPoint)
      if (result.isErr()) {
        this.lastError = result.error
        return
      }

      const moved = result.value
      const orphaned = new Set(
        openingsOn(this.document.openings, moved.id)
          .filter((opening) => createOpening(opening, moved).isErr())
          .map((opening) => opening.id),
      )

      this.lastError = null
      this.commit('wall.move-end', (draft) => {
        const index = draft.walls.findIndex((candidate) => candidate.id === moved.id)
        if (index >= 0) draft.walls[index] = moved
        if (orphaned.size > 0) {
          draft.openings = draft.openings.filter((opening) => !orphaned.has(opening.id))
        }
      })
    },

    // ── persistence ─────────────────────────────────────────────────────────

    /**
     * Opens the unit's plan, creating one if this is the first visit.
     *
     * The loaded geometry does NOT enter the history: the plan as saved is the
     * baseline, not an edit, and letting the first Ctrl+Z wipe the drawing the
     * user just opened would be indefensible.
     */
    async loadPlan(unitId: string, userId: string): Promise<boolean> {
      this.loading = true
      this.userId = userId

      try {
        const found = await fetchPlan(unitId)
        const result = found.ok ? found : await createPlan(unitId)
        if (!result.ok) {
          this.lastError = {
            kind: 'not_found',
            code: 'PLAN_UNAVAILABLE',
            message: result.error.title,
            i18nKey: 'errors.plan.unavailable',
          }
          return false
        }

        const plan = result.data
        this.planId = plan.id
        this.savedVersion = plan.version
        this.lock = plan.lock
        this.conflicted = false
        this.document = {
          walls: plan.geometry.walls,
          openings: plan.geometry.openings,
          structural: plan.geometry.structural,
          layers: plan.geometry.layers.length > 0 ? plan.geometry.layers : defaultLayers(),
          background: plan.geometry.background,
          roomAssignments: plan.geometry.roomAssignments,
        }
        this.history = emptyHistory<Patch>()
        this.selection = new Set()
        this.dirty = false

        await this.detectRooms()
        return true
      } finally {
        this.loading = false
      }
    },

    /**
     * Writes the plan, if there is anything to write.
     *
     * The version travels with the payload and the SERVER decides: a tab that
     * has been asleep while somebody else saved is refused rather than allowed
     * to overwrite work it never saw. docs/07 §6
     */
    async savePlan(): Promise<boolean> {
      if (!this.planId || !this.dirty || this.saving || this.readOnly) return false

      this.saving = true
      try {
        const result = await savePlanGeometry(this.planId, {
          geometry: {
            walls: this.document.walls,
            openings: this.document.openings,
            structural: this.document.structural,
            layers: this.document.layers,
            background: this.document.background,
            roomAssignments: this.document.roomAssignments,
          },
          rooms: this.rooms,
          expectedVersion: this.savedVersion,
        })

        if (!result.ok) {
          this.conflicted = result.error.code === 'CONCURRENT_MODIFICATION'
          this.lastError = {
            kind: this.conflicted ? 'conflict' : 'validation',
            code: result.error.code,
            message: result.error.title,
            i18nKey: `errors.${result.error.code.toLowerCase()}`,
          }
          return false
        }

        this.savedVersion = result.data.version
        this.dirty = false
        this.conflicted = false
        this.lastSavedAt = new Date()
        return true
      } finally {
        this.saving = false
      }
    },

    /**
     * Takes or refreshes the editor's lock. One call for both, so the path the
     * heartbeat runs every couple of minutes is the one that ran on open.
     */
    async heartbeat(): Promise<void> {
      if (!this.planId) return

      const result = await takeLock(this.planId)
      if (result.ok) {
        this.lock = result.data
        return
      }

      // Refused, so somebody else holds it. Reflecting that immediately is
      // what turns this editor read-only, rather than letting edits pile up
      // locally that the server will reject one by one.
      this.lock = {
        heldBy: 'someone-else',
        heldByName: result.error.title.replace(/^.*edited by /u, '') || null,
        expiresAt: new Date(Date.now() + 30_000),
      }
    },

    async releaseLock(): Promise<void> {
      if (!this.planId || this.readOnly) return
      await dropLock(this.planId)
      this.lock = noLock()
    },

    async loadRevisions(): Promise<void> {
      if (!this.planId) return
      const result = await fetchRevisions(this.planId)
      if (result.ok) this.revisions = result.data
    },

    /** Freezes the plan under a name. Saves first, so the snapshot is current. */
    async saveRevision(name: string): Promise<boolean> {
      if (!this.planId) return false
      await this.savePlan()

      const result = await createPlanRevision(this.planId, { name })
      if (!result.ok) {
        this.lastError = {
          kind: 'validation',
          code: result.error.code,
          message: result.error.title,
          i18nKey: `errors.${result.error.code.toLowerCase()}`,
        }
        return false
      }

      this.revisions = [result.data, ...this.revisions]
      return true
    },

    /**
     * Restores a revision, then rebuilds from what the server returned.
     *
     * The undo history is DROPPED rather than extended: the states before and
     * after a restore are two different drawings, and stepping back across
     * that boundary would apply patches to geometry they were never recorded
     * against.
     */
    async restoreRevision(revisionId: string): Promise<boolean> {
      if (!this.planId) return false

      const result = await restorePlanRevision(this.planId, revisionId)
      if (!result.ok) {
        this.lastError = {
          kind: 'conflict',
          code: result.error.code,
          message: result.error.title,
          i18nKey: `errors.${result.error.code.toLowerCase()}`,
        }
        return false
      }

      const plan = result.data
      this.savedVersion = plan.version
      this.document = {
        walls: plan.geometry.walls,
        openings: plan.geometry.openings,
        structural: plan.geometry.structural,
        layers: plan.geometry.layers.length > 0 ? plan.geometry.layers : defaultLayers(),
        background: plan.geometry.background,
        roomAssignments: plan.geometry.roomAssignments,
      }
      this.history = emptyHistory<Patch>()
      this.selection = new Set()
      this.dirty = false
      await this.detectRooms()
      return true
    },

    // ── rooms ───────────────────────────────────────────────────────────────

    /**
     * Re-derives the rooms from the walls, off the main thread. docs/08 §7.4
     *
     * NOT a commit. Rooms are computed from geometry the history already
     * holds, so recording them would put two entries in the undo stack for
     * every wall — and Ctrl+Z would step through a shadow of the drawing
     * rather than through what the user did.
     */
    async detectRooms(): Promise<void> {
      this.detecting = true
      // Its own counter, deliberately: sharing the entity sequence would let
      // drawing a wall mid-run invalidate a detection that was still correct.
      const token = (this.detectionToken += 1)

      try {
        const detected = await detectRoomsInWorker(this.document.walls)
        // A user drawing quickly outruns detection. Applying an older answer
        // over a newer one makes rooms flicker between two versions of the
        // truth, so a superseded run is simply dropped.
        if (token !== this.detectionToken) return

        this.rooms = reconcileRooms(detected, this.document.roomAssignments, {
          ceilingHeightMm: this.wallDefaults.heightMm,
        })
        if (this.activeRoomId && !this.rooms.some((room) => room.id === this.activeRoomId)) {
          this.activeRoomId = null
        }
      } finally {
        this.detecting = false
      }
    },

    /**
     * Records what a person says a space is.
     *
     * Keyed by SIGNATURE rather than by the room's id, so the name survives
     * every re-detection that leaves the bounding walls alone. This is the one
     * part of a room that cannot be recomputed, so it is the one part the
     * history keeps.
     */
    assignRoom(signature: string, patch: Partial<RoomAssignment>) {
      const current = this.document.roomAssignments[signature]
      const next: RoomAssignment = {
        name: patch.name ?? current?.name ?? '',
        typeCode: patch.typeCode !== undefined ? patch.typeCode : (current?.typeCode ?? null),
        ceilingHeightMm:
          patch.ceilingHeightMm ?? current?.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM,
      }

      this.commit('room.assign', (draft) => {
        draft.roomAssignments[signature] = next
      })
      // Applied locally too, so the panel updates without waiting for a walk
      // over the whole wall graph that would return the same geometry.
      this.rooms = this.rooms.map((room) =>
        room.signature === signature ? { ...room, ...next } : room,
      )
    },

    setActiveRoom(roomId: string | null) {
      this.activeRoomId = roomId
    },

    /** The room under a plan point — the smallest one containing it. */
    roomUnder(planPoint: Point): RoomBoundary | null {
      return roomAt(this.rooms, planPoint)
    },

    zoomToRoom(roomId: string) {
      const room = this.rooms.find((candidate) => candidate.id === roomId)
      if (!room || this.size.width === 0) return

      const bounds = room.polygon.reduce<Bounds | null>(
        (accumulated, vertex) =>
          accumulated
            ? {
                minX: Math.min(accumulated.minX, vertex.x),
                minY: Math.min(accumulated.minY, vertex.y),
                maxX: Math.max(accumulated.maxX, vertex.x),
                maxY: Math.max(accumulated.maxY, vertex.y),
              }
            : { minX: vertex.x, minY: vertex.y, maxX: vertex.x, maxY: vertex.y },
        null,
      )
      if (bounds) this.viewport = fitToBounds(this.viewport, bounds, this.size)
    },

    setTool(tool: PlannerTool) {
      this.tool = tool
      // A tool change abandons whatever was half-drawn: leaving the anchor
      // behind would make the next click continue a wall the user left.
      this.anchor = null
      this.marquee = null
      this.drag = null
      if (tool !== 'calibrate') this.calibration = null
    },

    /** The opening kind this tool places, or null if it places something else. */
    openingKindForTool(): OpeningKind | null {
      return OPENING_TOOLS[this.tool] ?? null
    },

    setSnapConfig(patch: Partial<SnapConfig>) {
      this.snapConfig = { ...this.snapConfig, ...patch }
    },

    clearSelection() {
      this.selection = new Set()
    },

    clearError() {
      this.lastError = null
    },
  },
})
