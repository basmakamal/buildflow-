import {
  type DomainError,
  type Result,
  type RoomId,
  err,
  ok,
  validationError,
} from '@buildflow/core'

/**
 * Room types the domain understands.
 *
 * The Gulf-specific entries (majlis, maid_room, driver_room) are not optional
 * flavour — a room programme that cannot express a مجلس cannot describe most
 * villas in the target market, and the BOQ rules key off these codes
 * (plumbing point counts differ per room type). docs/01 ROM-01
 */
export const ROOM_TYPES = [
  'bedroom',
  'master_bedroom',
  'bathroom',
  'guest_bathroom',
  'kitchen',
  'living_room',
  'dining_room',
  'reception',
  'majlis',
  'balcony',
  'laundry',
  'storage',
  'corridor',
  'staircase',
  'maid_room',
  'driver_room',
  'other',
] as const

export type RoomType = (typeof ROOM_TYPES)[number]

const ROOM_TYPE_SET: ReadonlySet<string> = new Set(ROOM_TYPES)
export const isRoomType = (value: string): value is RoomType => ROOM_TYPE_SET.has(value)

/**
 * Dimension bounds, in millimetres.
 *
 * Sanity rails, not business rules: a 100 mm-wide room is a typo (probably cm
 * entered as mm) and a 100 m one is a warehouse mis-keyed. Rejecting them at
 * the boundary beats generating a BOQ for 4 m² of skirting in a 0.1 m² room.
 */
const MIN_DIMENSION_MM = 300
const MAX_DIMENSION_MM = 50_000

export interface RoomGeometry {
  /** m², 4 dp — the input to floor-finish quantity rules */
  floorArea: string
  /** m², 4 dp — perimeter × height; opening deductions arrive with the planner */
  wallArea: string
  /** m², 4 dp — equals floorArea for flat ceilings */
  ceilingArea: string
  /** m, 4 dp — the input to skirting rules */
  perimeter: string
}

/**
 * Derives the areas every BOQ quantity rule starts from.
 *
 * Pure integer arithmetic in mm (docs/18 ADR-016), converted to metres only at
 * the formatting boundary — so two rooms with the same dimensions ALWAYS derive
 * the same areas, with no float drift for a client to dispute.
 */
export function deriveGeometry(widthMm: number, lengthMm: number, heightMm: number): RoomGeometry {
  const w = BigInt(widthMm)
  const l = BigInt(lengthMm)
  const h = BigInt(heightMm)

  const perimeterMm = 2n * (w + l)
  return {
    floorArea: mm2ToM2(w * l),
    wallArea: mm2ToM2(perimeterMm * h),
    ceilingArea: mm2ToM2(w * l),
    perimeter: mmToM(perimeterMm),
  }
}

export interface RoomProps {
  id: RoomId
  typeCode: RoomType
  nameEn: string
  nameAr: string
  widthMm: number
  lengthMm: number
  heightMm: number
  isAreaFromPlan: boolean
  sortOrder: number
}

export class Room {
  private constructor(
    readonly id: RoomId,
    readonly typeCode: RoomType,
    readonly nameEn: string,
    readonly nameAr: string,
    readonly widthMm: number,
    readonly lengthMm: number,
    readonly heightMm: number,
    readonly isAreaFromPlan: boolean,
    readonly sortOrder: number,
  ) {}

  static create(
    props: Omit<RoomProps, 'isAreaFromPlan' | 'typeCode'> & { typeCode: string },
  ): Result<Room, DomainError> {
    for (const [label, value] of [
      ['width', props.widthMm],
      ['length', props.lengthMm],
      ['height', props.heightMm],
    ] as const) {
      if (!Number.isInteger(value)) {
        return err(
          validationError('DIMENSION_NOT_INTEGER', `Room ${label} must be integer millimetres`, {
            dimension: label,
          }),
        )
      }
      if (value < MIN_DIMENSION_MM || value > MAX_DIMENSION_MM) {
        return err(
          validationError(
            'DIMENSION_OUT_OF_RANGE',
            `Room ${label} must be between ${MIN_DIMENSION_MM} and ${MAX_DIMENSION_MM} mm`,
            { dimension: label, value, min: MIN_DIMENSION_MM, max: MAX_DIMENSION_MM },
          ),
        )
      }
    }
    if (!isRoomType(props.typeCode)) {
      return err(validationError('UNKNOWN_ROOM_TYPE', `Unknown room type ${props.typeCode}`))
    }
    return ok(
      new Room(
        props.id,
        props.typeCode,
        props.nameEn,
        props.nameAr,
        props.widthMm,
        props.lengthMm,
        props.heightMm,
        false,
        props.sortOrder,
      ),
    )
  }

  static restore(props: RoomProps): Room {
    return new Room(
      props.id,
      props.typeCode,
      props.nameEn,
      props.nameAr,
      props.widthMm,
      props.lengthMm,
      props.heightMm,
      props.isAreaFromPlan,
      props.sortOrder,
    )
  }

  geometry(): RoomGeometry {
    return deriveGeometry(this.widthMm, this.lengthMm, this.heightMm)
  }
}

/** mm² → m² as a 4 dp decimal string. 1 m² = 1,000,000 mm²; 4 dp = /100 first. */
function mm2ToM2(mm2: bigint): string {
  // round half away from zero at the 4th decimal place
  const scaled = (mm2 + 50n) / 100n // now in units of 1e-4 m²
  return formatScaled(scaled)
}

/** mm → m as a 4 dp decimal string. */
function mmToM(mm: bigint): string {
  const scaled = mm * 10n // 1 mm = 10 × 1e-4 m
  return formatScaled(scaled)
}

function formatScaled(scaled: bigint): string {
  const digits = scaled.toString().padStart(5, '0')
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`
}
