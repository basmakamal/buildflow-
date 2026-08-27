import { pointInPolygon, type Point } from './geometry'
import type { DetectedRoom } from './room-detection'

/**
 * The room boundary — a detected face the user has taken ownership of.
 * docs/02 §3.5, docs/08 §7.4
 *
 * Detection produces geometry; this adds the two things only a person can
 * supply, a NAME and a TYPE, and keeps them across re-detection. That is the
 * whole reason `signature` exists: the walls bounding a space survive an edit
 * that moves it, so "Master bedroom" does not become "Room 3" every time
 * somebody drags a corner.
 *
 * The metrics here are exactly the inputs docs/02 §3.7's quantity rules
 * consume — floorArea, wallArea, perimeter, ceilingArea — computed once, from
 * the geometry, rather than typed in twice and disagreeing.
 */

export interface RoomBoundary {
  id: string
  /** The sorted wall ids that enclose it. Stable across geometry edits. */
  signature: string
  /**
   * The room-type code. Free text HERE on purpose: the canonical list lives in
   * the project module (`ROOM_TYPES`) and is enforced when a plan is saved,
   * because the geometry core has no business holding opinions about majlises.
   */
  typeCode: string | null
  name: string
  polygon: Point[]
  areaMm2: number
  perimeterMm: number
  wallIds: string[]
  ceilingHeightMm: number
}

/** Storey height, unless the user says otherwise. Matches the wall default. */
export const DEFAULT_CEILING_HEIGHT_MM = 3000

export interface RoomMetrics {
  floorAreaMm2: number
  ceilingAreaMm2: number
  perimeterMm: number
  wallAreaMm2: number
  volumeMm3: number
  /**
   * Perimeter less the doors, per docs/02 §3.7:
   * `skirting.quantity = room.perimeter − Σ(door.width) × (1 + waste)`.
   * Skirting stops at a doorway; it does not stop at a window.
   */
  skirtingLengthMm: number
}

/**
 * Everything the quantity rules need, derived from one polygon and a height.
 *
 * `doorWidthsMm` is passed in rather than looked up because a room does not
 * know its walls' openings — the caller joins those two, and doing it here
 * would drag the whole opening model into a file about areas.
 */
export function roomMetrics(
  room: Pick<RoomBoundary, 'areaMm2' | 'perimeterMm' | 'ceilingHeightMm'>,
  doorWidthsMm: readonly number[] = [],
): RoomMetrics {
  const doors = doorWidthsMm.reduce((total, width) => total + width, 0)

  return {
    floorAreaMm2: room.areaMm2,
    // Equal to the floor until a sloped or dropped ceiling is modelled, which
    // is a sprint-8 concern. Named separately so the rule that consumes it does
    // not have to change when that lands.
    ceilingAreaMm2: room.areaMm2,
    perimeterMm: room.perimeterMm,
    wallAreaMm2: room.perimeterMm * room.ceilingHeightMm,
    volumeMm3: room.areaMm2 * room.ceilingHeightMm,
    skirtingLengthMm: Math.max(0, room.perimeterMm - doors),
  }
}

/** What a person supplies about a space. Everything else is derived. */
export interface RoomAssignment {
  name: string
  typeCode: string | null
  ceilingHeightMm: number
}

export interface ReconcileOptions {
  /** The project's storey height, for rooms nobody has adjusted. */
  ceilingHeightMm?: number
}

/**
 * The id of a detected room.
 *
 * Derived from the signature rather than generated, so the same space keeps
 * the same id across a reload, a re-detection, and two browsers looking at the
 * same plan — none of which share a counter.
 */
export const roomIdFor = (signature: string): string => `room:${signature}`

/**
 * Folds a fresh detection into what the user has already said about their
 * rooms.
 *
 * Assignments are keyed by SIGNATURE, so a room keeps its name, type and
 * ceiling height through any edit that leaves its bounding walls in place —
 * and a face that no longer exists simply does not come back. Carrying a
 * vanished room forward would leave a named space with an area nothing on the
 * drawing supports, and it would still reach the BOQ.
 */
export function reconcileRooms(
  detected: readonly DetectedRoom[],
  assignments: Readonly<Record<string, RoomAssignment>>,
  options: ReconcileOptions = {},
): RoomBoundary[] {
  return detected.map((face) => {
    const assigned = assignments[face.signature]
    return {
      id: roomIdFor(face.signature),
      signature: face.signature,
      typeCode: assigned?.typeCode ?? null,
      name: assigned?.name ?? '',
      polygon: face.polygon,
      areaMm2: face.areaMm2,
      perimeterMm: face.perimeterMm,
      wallIds: face.wallIds,
      ceilingHeightMm:
        assigned?.ceilingHeightMm ?? options.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM,
    }
  })
}

/**
 * The room under a point — the smallest one containing it.
 *
 * Smallest, because a shaft inside a floor plate is inside both polygons and
 * the user is pointing at the shaft.
 */
export function roomAt(rooms: readonly RoomBoundary[], target: Point): RoomBoundary | null {
  let best: RoomBoundary | null = null
  for (const room of rooms) {
    if (!pointInPolygon(room.polygon, target)) continue
    if (!best || room.areaMm2 < best.areaMm2) best = room
  }
  return best
}

/**
 * Σ room.floorArea — checked against `unit.grossArea` in docs/02 §3.4, where
 * exceeding it is a WARNING rather than a rejection.
 */
export const totalFloorAreaMm2 = (rooms: readonly RoomBoundary[]): number =>
  rooms.reduce((total, room) => total + room.areaMm2, 0)

/** How many rooms are still waiting for someone to say what they are. */
export const unassignedRooms = (rooms: readonly RoomBoundary[]): RoomBoundary[] =>
  rooms.filter((room) => room.typeCode === null)
