import type { Facts, FactValue } from './rule'

/**
 * Translates a room into the fact vocabulary the rules speak.
 *
 * WHY A TRANSLATION LAYER EXISTS AT ALL: the project domain's room types
 * (packages/modules/project ROOM_TYPES) and the knowledge base's room codes
 * were authored separately and do not agree. Thirteen codes are shared; the
 * rest are not. Silently passing an unmapped code through would produce an
 * empty finding list that looks exactly like "this room is fine" — the most
 * dangerous possible output for a validation engine. So the mapping is explicit
 * and total: every domain room type either maps to a knowledge-base code or is
 * declared uncovered, and the caller is told which.
 */

/**
 * Domain room type → knowledge-base room code.
 *
 * `null` means the knowledge base has no standards for it. `other` is a
 * deliberate escape hatch in the project domain and can never be analysed —
 * it carries no semantics to reason about.
 */
export const ROOM_TYPE_TO_KB: Readonly<Record<string, string | null>> = {
  master_bedroom: 'master_bedroom',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  guest_bathroom: 'guest_bathroom',
  kitchen: 'kitchen',
  living_room: 'living_room',
  dining_room: 'dining_room',
  majlis: 'majlis',
  balcony: 'balcony',
  laundry: 'laundry',
  storage: 'storage',
  corridor: 'corridor',
  maid_room: 'maid_room',
  staircase: 'staircase',
  driver_room: 'driver_room',
  /// The KB models this as one room ("Majlis / Reception") because in the
  /// target market they are the same space with two names.
  reception: 'majlis',
  other: null,
}

/** Wet areas drive a large share of the critical rules, so this must be right. */
const WET_ROOM_CODES: ReadonlySet<string> = new Set([
  'bathroom',
  'guest_bathroom',
  'kitchen',
  'laundry',
])

export interface RoomInput {
  typeCode: string
  widthMm: number
  lengthMm: number
  heightMm: number
}

export interface DerivedFacts {
  /** null when the room type has no knowledge-base coverage. */
  facts: Facts | null
  kbRoomCode: string | null
}

/**
 * Derives the facts obtainable from room geometry alone.
 *
 * Deliberately small. These six are everything a room's dimensions can honestly
 * support today; socket counts, lux levels and fixture positions belong to
 * models that do not exist yet (Phase 3+). Callers may supply those as
 * overrides — see `mergeFacts` — but this function will not invent them.
 */
export function deriveRoomFacts(room: RoomInput): DerivedFacts {
  const kbRoomCode = ROOM_TYPE_TO_KB[room.typeCode] ?? null
  if (kbRoomCode === null) return { facts: null, kbRoomCode: null }

  // Metres, rounded to 2 dp. Rules compare against thresholds like "area > 20"
  // and "width < 2.4", where sub-centimetre precision is noise.
  const round2 = (value: number): number => Math.round(value * 100) / 100
  const widthM = room.widthMm / 1000
  const lengthM = room.lengthMm / 1000

  return {
    kbRoomCode,
    facts: {
      roomType: kbRoomCode,
      area: round2(widthM * lengthM),
      // `width` is the SHORTER side and `length` the longer one, regardless of
      // which the user typed where. Rules like "bedroom narrower than 2.4 m
      // cannot take a bed with circulation" are about the constraining
      // dimension, not about field order in a form.
      width: round2(Math.min(widthM, lengthM)),
      length: round2(Math.max(widthM, lengthM)),
      ceilingHeight: round2(room.heightMm / 1000),
      isWetArea: WET_ROOM_CODES.has(kbRoomCode),
    },
  }
}

/**
 * Overlays caller-supplied facts onto derived ones.
 *
 * Lets a designer ask "what if this room had 4 sockets" before any electrical
 * model exists, and means the endpoint needs no rewrite when those models land
 * — the same facts will simply arrive from the database instead of the request
 * body. Unknown fact codes are dropped by the caller, not here.
 *
 * Derived geometry wins over supplied values for `roomType` and `isWetArea`:
 * those are facts about the room as recorded, not hypotheses, and letting a
 * request claim a bathroom is dry would disable every critical wet-area rule.
 */
export function mergeFacts(derived: Facts, supplied: Facts): Facts {
  const merged: Record<string, FactValue | undefined> = { ...derived }
  for (const [key, value] of Object.entries(supplied)) {
    if (key === 'roomType' || key === 'isWetArea') continue
    if (value === undefined) continue
    merged[key] = value
  }
  return merged
}
