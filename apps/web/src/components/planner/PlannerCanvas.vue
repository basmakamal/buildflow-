<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Konva from 'konva'
import {
  distance,
  findLayer,
  gridStepMm,
  isBeam,
  mmToMetres,
  openingPolygon,
  openingSegment,
  openingsOn,
  polygonCentroid,
  resolveHits,
  squareMmToSquareMetres,
  structuralPolygon,
  toScreen,
  visibleBounds,
  wallAngleDeg,
  wallLengthMm,
  wallPolygon,
  type ExportLayout,
  type Opening,
  type Point,
  type RoomBoundary,
  type StructuralElement,
  type TitleBlock,
  type Wall,
} from '@buildflow/spatial'
import { usePlannerStore } from '@/stores/planner'

/**
 * The Konva stage. docs/08 §7.1
 *
 * A RENDERER, deliberately: it computes no coordinate and owns no rule. Every
 * transform, snap and selection decision comes from @buildflow/spatial through
 * the store, which is why those can be tested in milliseconds while this file
 * stays a thin bridge between pointer events and pixels.
 *
 * The layer split is the performance story. Static layers set
 * `listening: false` so hit-testing walks only what is actually interactive —
 * docs/08 calls this the difference between 60 FPS and 20 FPS on a large plan.
 * Walls are additionally CULLED through the R-tree, so a plan that extends far
 * beyond the window costs only what is on screen. docs/08 §7.5
 */

const store = usePlannerStore()
const host = ref<HTMLDivElement | null>(null)

let stage: Konva.Stage | null = null
let backgroundLayer: Konva.Layer | null = null
let gridLayer: Konva.Layer | null = null
let structureLayer: Konva.Layer | null = null
let wallLayer: Konva.Layer | null = null
let roomLayer: Konva.Layer | null = null
let annotationLayer: Konva.Layer | null = null
let uiLayer: Konva.Layer | null = null
let observer: ResizeObserver | null = null

/** The decoded underlay. Kept out of the store: it is pixels, not plan data. */
let backgroundImage: HTMLImageElement | null = null
let backgroundSource: string | null = null

/** Middle-button or pan-tool dragging, tracked in screen pixels. */
let panning: { x: number; y: number } | null = null
let dragging = false

/** How close, in pixels, a press must be to an endpoint to grab its handle. */
const HANDLE_GRAB_PX = 9
const HANDLE_RADIUS_PX = 5

const SELECTED = '#2563eb'
const WALL_FILL = 'rgba(51, 65, 85, 0.85)'
const WALL_STROKE = '#1e293b'
const GUIDE = '#f59e0b'
const OPENING_INK = '#334155'

const pointerOf = (event: { clientX: number; clientY: number }) => {
  const rect = host.value?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

/** Plan millimetres as the metres a drawing is labelled in. docs/18 ADR-016 */
const metres = (valueMm: number) => `${Number(mmToMetres(valueMm)).toFixed(2)} m`

const screenPoints = (points: readonly Point[]) =>
  points.flatMap((corner) => {
    const projected = toScreen(store.viewport, corner)
    return [projected.x, projected.y]
  })

/** A layer's colour override, or the default the caller passes. */
const inkFor = (layer: string, fallback: string) =>
  findLayer(store.layers, layer)?.colour ?? fallback

// ── background ──────────────────────────────────────────────────────────────

/**
 * Decodes the underlay when its source changes.
 *
 * The image element is deliberately NOT in the store: a decoded bitmap is not
 * plan data, it does not belong in an undo patch, and structuredClone would
 * choke on it the moment the plan was persisted.
 */
function syncBackgroundImage() {
  const source = store.background?.source ?? null
  if (source === backgroundSource) return

  backgroundSource = source
  backgroundImage = null
  if (!source) {
    drawBackground()
    return
  }

  const image = new Image()
  image.onload = () => {
    // Guard against a second image landing first: only the CURRENT source wins.
    if (backgroundSource !== source) return
    backgroundImage = image
    drawBackground()
  }
  image.src = source
}

function drawBackground() {
  if (!backgroundLayer) return
  backgroundLayer.destroyChildren()

  const background = store.background
  if (background && backgroundImage) {
    const origin = toScreen(store.viewport, background.origin)
    // One image pixel is `mmPerPixel` plan millimetres, and the viewport turns
    // millimetres into screen pixels — so the two scales simply multiply.
    const scale = background.mmPerPixel * store.viewport.scale
    backgroundLayer.add(
      new Konva.Image({
        image: backgroundImage,
        x: origin.x,
        y: origin.y,
        scaleX: scale,
        scaleY: scale,
        rotation: background.rotationDeg,
        opacity: background.opacity,
        listening: false,
      }),
    )
  }
  backgroundLayer.batchDraw()
}

// ── grid ────────────────────────────────────────────────────────────────────

function drawGrid() {
  if (!gridLayer || store.size.width === 0) return
  gridLayer.destroyChildren()

  const step = gridStepMm(store.viewport)
  const bounds = visibleBounds(store.viewport, store.size)
  // Every fifth line is emphasised, so the eye can count without a ruler.
  const majorEvery = 5

  const firstX = Math.floor(bounds.minX / step) * step
  for (let x = firstX; x <= bounds.maxX; x += step) {
    const screenX = toScreen(store.viewport, { x, y: 0 }).x
    const major = Math.round(x / step) % majorEvery === 0
    gridLayer.add(
      new Konva.Line({
        points: [screenX, 0, screenX, store.size.height],
        stroke: major ? 'rgba(148, 163, 184, 0.55)' : 'rgba(148, 163, 184, 0.25)',
        strokeWidth: 1,
        listening: false,
      }),
    )
  }

  const firstY = Math.floor(bounds.minY / step) * step
  for (let y = firstY; y <= bounds.maxY; y += step) {
    const screenY = toScreen(store.viewport, { x: 0, y }).y
    const major = Math.round(y / step) % majorEvery === 0
    gridLayer.add(
      new Konva.Line({
        points: [0, screenY, store.size.width, screenY],
        stroke: major ? 'rgba(148, 163, 184, 0.55)' : 'rgba(148, 163, 184, 0.25)',
        strokeWidth: 1,
        listening: false,
      }),
    )
  }

  // The world origin, so a plan is never floating in undifferentiated space.
  const origin = toScreen(store.viewport, { x: 0, y: 0 })
  gridLayer.add(
    new Konva.Line({
      points: [origin.x - 12, origin.y, origin.x + 12, origin.y],
      stroke: 'rgba(239, 68, 68, 0.8)',
      strokeWidth: 1.5,
      listening: false,
    }),
  )
  gridLayer.add(
    new Konva.Line({
      points: [origin.x, origin.y - 12, origin.x, origin.y + 12],
      stroke: 'rgba(239, 68, 68, 0.8)',
      strokeWidth: 1.5,
      listening: false,
    }),
  )
  gridLayer.batchDraw()
}

// ── walls, openings, structure ──────────────────────────────────────────────

/** What is on screen and on a visible layer, in document order. */
function culled<T extends { id: string }>(items: readonly T[]): T[] {
  if (store.size.width === 0) return [...items]
  return resolveHits(items, store.index.search(visibleBounds(store.viewport, store.size)))
}

function drawWalls(walls: readonly Wall[]) {
  if (!wallLayer) return
  wallLayer.destroyChildren()

  for (const wall of walls) {
    const selected = store.selection.has(wall.id)
    wallLayer.add(
      new Konva.Line({
        // The thick quad is DERIVED from the centreline every frame, so what
        // is drawn can never drift from the topology room detection will read.
        points: screenPoints(wallPolygon(wall)),
        closed: true,
        fill: selected ? 'rgba(37, 99, 235, 0.45)' : inkFor(wall.layer, WALL_FILL),
        stroke: selected ? SELECTED : inkFor(wall.layer, WALL_STROKE),
        strokeWidth: selected ? 2 : 1,
        listening: false,
      }),
    )
  }

  // Openings are punched OUT of the walls rather than painted over them:
  // painting would need to know the colour behind, and the grid would stop
  // running through the door the way a plan expects.
  for (const wall of walls) {
    for (const opening of openingsOn(store.openings, wall.id)) {
      wallLayer.add(
        new Konva.Line({
          points: screenPoints(openingPolygon(wall, opening)),
          closed: true,
          fill: '#000',
          globalCompositeOperation: 'destination-out',
          listening: false,
        }),
      )
    }
  }
  wallLayer.batchDraw()
}

function drawStructure(elements: readonly StructuralElement[]) {
  if (!structureLayer) return
  structureLayer.destroyChildren()

  for (const element of elements) {
    const selected = store.selection.has(element.id)
    structureLayer.add(
      new Konva.Line({
        points: screenPoints(structuralPolygon(element)),
        closed: true,
        fill: selected ? 'rgba(37, 99, 235, 0.45)' : 'rgba(124, 58, 237, 0.35)',
        stroke: selected ? SELECTED : inkFor(element.layer, '#7c3aed'),
        strokeWidth: selected ? 2 : 1,
        // A hatched column reads as structure rather than as another room.
        ...(isBeam(element) ? { dash: [10, 6] } : {}),
        listening: false,
      }),
    )
  }
  structureLayer.batchDraw()
}

/**
 * The conventional symbols: a door draws its swing, a window its glazing.
 *
 * Without them a plan is a wall with a gap in it, and a client cannot tell a
 * door from a window — which is the first question anybody asks of a plan.
 */
function drawOpeningSymbol(layer: Konva.Layer, wall: Wall, opening: Opening) {
  const segment = openingSegment(wall, opening)
  const from = toScreen(store.viewport, segment.start)
  const to = toScreen(store.viewport, segment.end)
  const widthPx = Math.hypot(to.x - from.x, to.y - from.y)
  // Below a few pixels the symbol is a smudge; the gap alone reads better.
  if (widthPx < 8) return

  const ink = store.selection.has(opening.id) ? SELECTED : OPENING_INK
  const headingRad = (wallAngleDeg(wall) * Math.PI) / 180

  if (opening.kind === 'door') {
    // Leaf drawn from the near jamb, swinging through a quarter circle.
    const leafEnd = {
      x: from.x + Math.cos(headingRad - Math.PI / 2) * widthPx,
      y: from.y + Math.sin(headingRad - Math.PI / 2) * widthPx,
    }
    layer.add(
      new Konva.Line({
        points: [from.x, from.y, leafEnd.x, leafEnd.y],
        stroke: ink,
        strokeWidth: 1,
        listening: false,
      }),
    )
    layer.add(
      new Konva.Shape({
        stroke: ink,
        strokeWidth: 1,
        listening: false,
        sceneFunc: (context, shape) => {
          context.beginPath()
          context.arc(from.x, from.y, widthPx, headingRad - Math.PI / 2, headingRad, false)
          context.strokeShape(shape)
        },
      }),
    )
    return
  }

  // A window is glazing across the reveal: one line down the centre of the
  // opening, which is what a 1:100 plan shows.
  layer.add(
    new Konva.Line({
      points: [from.x, from.y, to.x, to.y],
      stroke: ink,
      strokeWidth: 1.5,
      listening: false,
    }),
  )
}

/**
 * Detected rooms: a wash of colour and the area, which is the number this
 * whole sprint exists to produce. An unnamed room is drawn in a warning
 * colour, because docs/02 §3.7's quantity rules key off the room TYPE — an
 * unnamed space silently contributes nothing to the BOQ.
 */
function drawRooms(rooms: readonly RoomBoundary[]) {
  if (!roomLayer) return
  roomLayer.destroyChildren()

  for (const room of rooms) {
    const active = store.activeRoomId === room.id
    const named = room.typeCode !== null

    roomLayer.add(
      new Konva.Line({
        points: screenPoints(room.polygon),
        closed: true,
        fill: active
          ? 'rgba(37, 99, 235, 0.20)'
          : named
            ? 'rgba(16, 185, 129, 0.12)'
            : 'rgba(245, 158, 11, 0.12)',
        listening: false,
      }),
    )

    const centre = toScreen(store.viewport, polygonCentroid(room.polygon))
    const area = `${Number(squareMmToSquareMetres(room.areaMm2)).toFixed(2)} m²`
    const label = new Konva.Text({
      text: room.name ? `${room.name}\n${area}` : area,
      fontSize: 12,
      fontFamily: 'inherit',
      align: 'center',
      fill: active ? '#1d4ed8' : '#334155',
      listening: false,
    })
    label.position({ x: centre.x, y: centre.y })
    label.offsetX(label.width() / 2)
    label.offsetY(label.height() / 2)
    roomLayer.add(label)
  }
  roomLayer.batchDraw()
}

/** A dimension label centred on a run, laid along it and never upside down. */
function addDimension(layer: Konva.Layer, from: Point, to: Point, text: string, colour: string) {
  const start = toScreen(store.viewport, from)
  const end = toScreen(store.viewport, to)
  const lengthPx = Math.hypot(end.x - start.x, end.y - start.y)
  // Below this the label is wider than what it describes and becomes noise.
  if (lengthPx < 44) return

  const degrees = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
  const label = new Konva.Text({
    text,
    fontSize: 12,
    fontFamily: 'inherit',
    fill: colour,
    listening: false,
  })
  label.position({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 })
  label.offsetX(label.width() / 2)
  // Clear of the centreline, on whichever side keeps the text readable.
  label.offsetY(label.height() + 6)
  label.rotation(degrees > 90 || degrees < -90 ? degrees - 180 : degrees)
  layer.add(label)
}

function drawAnnotations(walls: readonly Wall[]) {
  if (!annotationLayer) return
  annotationLayer.destroyChildren()

  for (const wall of walls) {
    addDimension(annotationLayer, wall.start, wall.end, metres(wallLengthMm(wall)), '#475569')
    for (const opening of openingsOn(store.openings, wall.id)) {
      drawOpeningSymbol(annotationLayer, wall, opening)
    }
  }
  annotationLayer.batchDraw()
}

// ── interaction overlay ─────────────────────────────────────────────────────

function drawUi() {
  if (!uiLayer) return
  uiLayer.destroyChildren()

  const marquee = store.marqueeBounds
  if (marquee) {
    const topLeft = toScreen(store.viewport, { x: marquee.minX, y: marquee.minY })
    const bottomRight = toScreen(store.viewport, { x: marquee.maxX, y: marquee.maxY })
    const crossing = (store.marquee?.current.x ?? 0) < (store.marquee?.origin.x ?? 0)
    uiLayer.add(
      new Konva.Rect({
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
        fill: crossing ? 'rgba(16, 185, 129, 0.12)' : 'rgba(37, 99, 235, 0.12)',
        stroke: crossing ? '#10b981' : SELECTED,
        // Dashed for a crossing selection, solid for a window — the same
        // visual language every CAD tool uses for the same two meanings.
        ...(crossing ? { dash: [6, 4] } : {}),
        strokeWidth: 1,
        listening: false,
      }),
    )
  }

  // The wall or beam in progress, with its length live beside it.
  const draft = store.draft
  if (draft && (store.tool === 'wall' || store.tool === 'beam')) {
    const start = toScreen(store.viewport, draft.start)
    const end = toScreen(store.viewport, draft.end)
    uiLayer.add(
      new Konva.Line({
        points: [start.x, start.y, end.x, end.y],
        stroke: store.tool === 'beam' ? '#7c3aed' : SELECTED,
        strokeWidth: Math.max(1, store.wallDefaults.thicknessMm * store.viewport.scale),
        opacity: 0.35,
        listening: false,
      }),
    )
    addDimension(
      uiLayer,
      draft.start,
      draft.end,
      metres(Math.round(distance(draft.start, draft.end))),
      SELECTED,
    )
  }

  drawCalibration()

  const guide = store.lastSnap?.guide
  if (guide) {
    const from = toScreen(store.viewport, guide.from)
    const to = toScreen(store.viewport, guide.to)
    uiLayer.add(
      new Konva.Line({
        points: [from.x, from.y, to.x, to.y],
        stroke: GUIDE,
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      }),
    )
  }

  // The snap marker — a square, so the user can see WHICH kind of snap they
  // are about to take rather than guessing from a point that merely moved.
  if (store.lastSnap?.kind && store.pointer) {
    const at = toScreen(store.viewport, store.pointer)
    uiLayer.add(
      new Konva.Rect({
        x: at.x - 4,
        y: at.y - 4,
        width: 8,
        height: 8,
        stroke: GUIDE,
        strokeWidth: 1.5,
        listening: false,
      }),
    )
  }

  // Endpoint handles, on the single selected wall only: two draggable corners
  // are a handle, twenty are a minefield.
  const selected = store.selectedWall
  if (selected && store.tool === 'select') {
    for (const corner of [selected.start, selected.end]) {
      const at = toScreen(store.viewport, corner)
      uiLayer.add(
        new Konva.Circle({
          x: at.x,
          y: at.y,
          radius: HANDLE_RADIUS_PX,
          fill: '#fff',
          stroke: SELECTED,
          strokeWidth: 2,
          listening: false,
        }),
      )
    }
  }
  uiLayer.batchDraw()
}

/** The calibration line, drawn while the user picks the distance they know. */
function drawCalibration() {
  const calibration = store.calibration
  if (!uiLayer || !calibration) return

  const from = toScreen(store.viewport, calibration.from)
  const to = toScreen(store.viewport, calibration.to ?? store.pointer ?? calibration.from)

  uiLayer.add(
    new Konva.Line({
      points: [from.x, from.y, to.x, to.y],
      stroke: '#dc2626',
      strokeWidth: 2,
      listening: false,
    }),
  )
  for (const end of [from, to]) {
    uiLayer.add(
      new Konva.Circle({
        x: end.x,
        y: end.y,
        radius: 4,
        fill: '#dc2626',
        listening: false,
      }),
    )
  }
}

// ── export ──────────────────────────────────────────────────────────────────

/**
 * Renders the plan onto a sheet and returns it as a PNG data URL.
 * docs/16 Phase 5 sprint 7
 *
 * The stage is reused rather than a second one built offscreen: it already
 * holds the layer stack, the background image and every drawing rule, and a
 * parallel renderer would be a second place for those to drift. The viewport
 * and size are restored in a `finally`, so a failure mid-render leaves the
 * user looking at their plan rather than at a printer's-eye view of it.
 *
 * The grid and the interaction overlay are OMITTED. A screen grid on a printed
 * drawing is noise, and a marquee or a snap marker on a sheet handed to a
 * client is an artefact of somebody's mouse.
 */
function exportImage(layout: ExportLayout, block: TitleBlock): string | null {
  if (!stage) return null

  const savedViewport = { ...store.viewport }
  const savedSize = { ...store.size }

  try {
    store.viewport = layout.viewport
    store.setSize({ width: layout.widthPx, height: layout.heightPx })
    stage.size({ width: layout.widthPx, height: layout.heightPx })

    const walls = store.visibleWalls
    drawBackground()
    drawStructure(store.visibleStructural)
    drawWalls(walls)
    drawRooms(store.rooms)
    drawAnnotations(walls)

    gridLayer?.destroyChildren()
    uiLayer?.destroyChildren()
    drawSheet(layout, block)
    gridLayer?.batchDraw()
    uiLayer?.batchDraw()

    return stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 })
  } finally {
    store.viewport = savedViewport
    store.setSize(savedSize)
    stage.size({ width: savedSize.width, height: savedSize.height })
    redraw()
  }
}

/** The border and the title block — drawn on the UI layer, which is empty here. */
function drawSheet(layout: ExportLayout, block: TitleBlock) {
  if (!uiLayer) return

  const margin = (layout.marginMm / layout.paperWidthMm) * layout.widthPx
  uiLayer.add(
    new Konva.Rect({
      x: margin,
      y: margin,
      width: layout.widthPx - margin * 2,
      height: layout.heightPx - margin * 2,
      stroke: '#1e293b',
      strokeWidth: 2,
      listening: false,
    }),
  )

  const lines = [
    block.planName,
    block.unitLabel,
    `${block.scaleLabel}  ·  ${block.areaLabel}`,
    block.dateLabel,
  ].filter((line) => line.length > 0)

  const fontSize = Math.max(12, Math.round(layout.widthPx / 90))
  const padding = fontSize
  const boxWidth = layout.widthPx / 3.2
  const boxHeight = padding * 2 + lines.length * fontSize * 1.45

  uiLayer.add(
    new Konva.Rect({
      x: layout.widthPx - margin - boxWidth,
      y: layout.heightPx - margin - boxHeight,
      width: boxWidth,
      height: boxHeight,
      fill: '#fff',
      stroke: '#1e293b',
      strokeWidth: 2,
      listening: false,
    }),
  )
  uiLayer.add(
    new Konva.Text({
      x: layout.widthPx - margin - boxWidth + padding,
      y: layout.heightPx - margin - boxHeight + padding,
      width: boxWidth - padding * 2,
      text: lines.join('\n'),
      fontSize,
      lineHeight: 1.45,
      fontFamily: 'inherit',
      fill: '#0f172a',
      listening: false,
    }),
  )
}

function redraw() {
  const walls = culled(store.visibleWalls)
  syncBackgroundImage()
  drawBackground()
  drawGrid()
  drawStructure(culled(store.visibleStructural))
  drawWalls(walls)
  drawRooms(store.rooms)
  drawAnnotations(walls)
  drawUi()
}

// ── input ───────────────────────────────────────────────────────────────────

function onWheel(event: WheelEvent) {
  event.preventDefault()
  // A fixed ratio per notch: zoom that accelerates with scroll velocity is
  // impossible to land precisely.
  store.zoomAt(pointerOf(event), event.deltaY < 0 ? 1.1 : 1 / 1.1)
}

/** Which endpoint of the selected wall is under the pointer, if any. */
function handleUnder(screen: Point) {
  const wall = store.selectedWall
  if (!wall || store.tool !== 'select') return null

  for (const end of ['start', 'end'] as const) {
    if (distance(toScreen(store.viewport, wall[end]), screen) <= HANDLE_GRAB_PX) {
      return { wallId: wall.id, end }
    }
  }
  return null
}

function onPointerDown(event: PointerEvent) {
  const pointer = pointerOf(event)
  if (event.button === 1 || store.tool === 'pan') {
    panning = pointer
    host.value?.setPointerCapture(event.pointerId)
    return
  }
  if (event.button !== 0) return

  host.value?.setPointerCapture(event.pointerId)
  const planPoint = store.resolvePointer(pointer)

  if (store.tool === 'wall' || store.tool === 'beam') {
    store.placeWallPoint(planPoint)
    return
  }

  const openingKind = store.openingKindForTool()
  if (openingKind) {
    store.placeOpening(planPoint, openingKind)
    return
  }

  if (store.tool === 'column') {
    store.placeColumn(planPoint)
    return
  }

  if (store.tool === 'calibrate') {
    store.pickCalibrationPoint(planPoint)
    return
  }

  const grabbed = handleUnder(pointer)
  if (grabbed) {
    store.beginDrag(grabbed.wallId, grabbed.end)
    return
  }

  dragging = true
  store.beginMarquee(pointer)
}

function onPointerMove(event: PointerEvent) {
  const pointer = pointerOf(event)
  if (panning) {
    store.pan(pointer.x - panning.x, pointer.y - panning.y)
    panning = pointer
    return
  }
  if (dragging) {
    store.updateMarquee(pointer)
    return
  }
  // Idle movement still resolves a snap, so both the guide and the ghost
  // track the cursor — and a drag resolves it against everything but the wall
  // being dragged.
  store.resolvePointer(pointer)
}

function onPointerUp(event: PointerEvent) {
  host.value?.releasePointerCapture(event.pointerId)
  if (panning) {
    panning = null
    return
  }
  if (store.drag) {
    store.endDrag(store.resolvePointer(pointerOf(event)))
    return
  }
  if (!dragging) return
  dragging = false

  const mode = event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace'
  const marquee = store.marqueeBounds
  // A marquee smaller than a few pixels is a click, not a drag — treating it
  // as a drag makes single selection feel unreliable.
  const tiny =
    !marquee ||
    (Math.abs(marquee.maxX - marquee.minX) * store.viewport.scale < 3 &&
      Math.abs(marquee.maxY - marquee.minY) * store.viewport.scale < 3)

  if (tiny) {
    store.marquee = null
    store.selectAt(pointerOf(event), mode)
    return
  }
  store.endMarquee(mode)
}

/** A double-click ends a chain — the gesture every CAD tool uses for it. */
function onDoubleClick() {
  if (store.tool === 'wall' || store.tool === 'beam') store.finishWallChain()
}

function onContextMenu(event: MouseEvent) {
  if (!store.anchor) return
  event.preventDefault()
  store.finishWallChain()
}

function onKeydown(event: KeyboardEvent) {
  // A keystroke aimed at the dimension field is not a planner shortcut.
  if (event.target instanceof HTMLInputElement) return

  const meta = event.ctrlKey || event.metaKey
  if (meta && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) store.redo()
    else store.undo()
    return
  }
  if (meta && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    store.redo()
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    store.deleteSelected()
    return
  }
  if (event.key === 'Escape') {
    // Escape backs out of whatever is in progress first, and only clears the
    // selection once there is nothing left to abandon.
    if (store.calibrating) store.cancelCalibration()
    else if (store.anchor) store.finishWallChain()
    else store.clearSelection()
  }
}

function measure() {
  const element = host.value
  if (!element || !stage) return
  const { width, height } = element.getBoundingClientRect()
  store.setSize({ width, height })
  stage.size({ width, height })
  redraw()
}

onMounted(() => {
  const element = host.value
  if (!element) return

  stage = new Konva.Stage({ container: element, width: 1, height: 1 })
  // docs/08 §7.1 — the layer stack, bottom to top. Nothing listens: pointer
  // events arrive on the host element and are resolved against the plan.
  backgroundLayer = new Konva.Layer({ listening: false })
  gridLayer = new Konva.Layer({ listening: false })
  structureLayer = new Konva.Layer({ listening: false })
  wallLayer = new Konva.Layer({ listening: false })
  roomLayer = new Konva.Layer({ listening: false })
  annotationLayer = new Konva.Layer({ listening: false })
  uiLayer = new Konva.Layer({ listening: false })
  stage.add(
    backgroundLayer,
    gridLayer,
    structureLayer,
    wallLayer,
    roomLayer,
    annotationLayer,
    uiLayer,
  )

  observer = new ResizeObserver(() => {
    measure()
  })
  observer.observe(element)
  measure()

  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  observer?.disconnect()
  stage?.destroy()
  stage = null
  backgroundImage = null
})

/** The one thing this component offers its parent: a rendered sheet. */
defineExpose({ exportImage })

/**
 * Three watchers, not one — the whole point of the layer stack.
 *
 * The layers exist so that a change redraws only the canvases it touched
 * (docs/08 §7.1), but a single watcher that calls `redraw()` collects none of
 * that: with `pointer` in its list, EVERY MOUSE MOVE destroyed and rebuilt all
 * ~600 nodes and rasterised all seven canvases. At 500 objects that is most of
 * the 16 ms frame budget spent redrawing walls that did not change.
 *
 * Split by what a change can actually touch:
 *  - geometry, viewport, rooms — the drawing itself; everything repaints.
 *  - selection — tints walls and structure, places the endpoint handles.
 *  - the pointer group — the interaction overlay only: a handful of nodes on
 *    one canvas, which is what makes a mouse move cheap.
 */
watch(
  () => [store.viewport, store.document, store.rooms, store.activeRoomId],
  () => {
    redraw()
  },
  { deep: true },
)

watch(
  () => store.selection,
  () => {
    drawStructure(culled(store.visibleStructural))
    drawWalls(culled(store.visibleWalls))
    drawUi()
  },
  { deep: true },
)

watch(
  () => [store.pointer, store.lastSnap, store.anchor, store.marquee, store.tool, store.calibration],
  () => {
    drawUi()
  },
  { deep: true },
)
</script>

<template>
  <div
    ref="host"
    class="planner-canvas"
    :class="{
      'planner-canvas--panning': store.tool === 'pan',
      'planner-canvas--drawing': store.tool !== 'select' && store.tool !== 'pan',
    }"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
  />
</template>

<style scoped>
.planner-canvas {
  position: absolute;
  inset: 0;
  background: var(--color-surface-sunken, #f8fafc);
  cursor: default;
  touch-action: none;
}

.planner-canvas--panning {
  cursor: grab;
}

.planner-canvas--drawing {
  cursor: crosshair;
}
</style>
